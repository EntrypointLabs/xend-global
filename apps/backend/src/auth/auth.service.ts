import {
  Injectable,
  UnauthorizedException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { GridService } from '../grid/grid.service';
import { DbService } from '../db/db.service';
import { users, smartAccounts } from '../db/schema';
import { eq } from 'drizzle-orm';
import {
  CompleteAuthAndCreateAccountResponse,
  CompleteAuthResponse,
  SessionSecrets,
  MetaInfo,
  GridClientUserContext,
} from '@sqds/grid';
import { PublicKey } from '@solana/web3.js';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private grid: GridService,
    private jwt: JwtService,
    private db: DbService,
  ) {}

  private handleGridError(error: unknown, context: string): never {
    this.logger.error(`Grid error in ${context}:`, error);

    const err = error as Record<string, unknown> | undefined;
    const lastResponse = err?.lastResponse as
      | Record<string, unknown>
      | undefined;
    const cause = lastResponse?.cause as Record<string, unknown> | undefined;
    const response = err?.response as Record<string, unknown> | undefined;
    const data = response?.data as Record<string, unknown> | undefined;

    const status =
      cause?.statusCode ?? err?.statusCode ?? response?.status ?? err?.status;
    const message =
      (data?.message as string) ??
      (err?.message as string) ??
      'Grid service error';
    const code =
      (data?.code as string) ?? (err?.code as string) ?? 'GRID_ERROR';

    // Map known Grid status codes to HTTP status codes
    if (status === 404 || message.toLowerCase().includes('not found')) {
      throw new HttpException(
        { code: 'USER_NOT_FOUND', message },
        HttpStatus.NOT_FOUND,
      );
    }
    if (status === 401 || message.toLowerCase().includes('unauthorized')) {
      throw new HttpException(
        { code: 'UNAUTHORIZED', message },
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (
      status === 409 ||
      message.toLowerCase().includes('already exists') ||
      message.toLowerCase().includes('conflict')
    ) {
      throw new HttpException(
        { code: 'USER_ALREADY_EXISTS', message },
        HttpStatus.CONFLICT,
      );
    }
    if (status === 429 || message.toLowerCase().includes('rate limit')) {
      throw new HttpException(
        { code: 'OTP_RATE_LIMIT', message },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    throw new HttpException(
      { code, message },
      typeof status === 'number' && status >= 400
        ? status
        : HttpStatus.BAD_GATEWAY,
    );
  }

  // Registration

  // Step 1: mobile sends email - Grid sends OTP
  async register(email: string) {
    try {
      return await this.grid.createAccount(email);
    } catch (error) {
      this.handleGridError(error, 'register');
    }
  }

  // Step 2: mobile sends OTP + sessionSecrets + user context
  // Grid creates the smart account automatically with Turnkey MPC
  async verifyOtpAndCreateAccount(dto: {
    otpCode: string;
    sessionSecrets: SessionSecrets;
    user: GridClientUserContext;
  }) {
    let gridResponse: CompleteAuthAndCreateAccountResponse;
    try {
      gridResponse = await this.grid.completeAuthAndCreateAccount({
        otpCode: dto.otpCode,
        sessionSecrets: dto.sessionSecrets,
        user: dto.user,
      });
    } catch (error) {
      this.handleGridError(error, 'verifyOtpAndCreateAccount');
    }

    const address = gridResponse.data.address;

    // Check if user already exists (e.g. re-registration attempt)
    const existingAccount = await this.db.client
      .select()
      .from(smartAccounts)
      .where(eq(smartAccounts.gridAccountId, address))
      .limit(1);

    if (existingAccount.length > 0) {
      // Already registered — just return a JWT
      const token = this.jwt.sign({
        sub: existingAccount[0].userId,
        gridAccountId: address,
      });
      return { ...gridResponse, token };
    }

    // First time — persist user + smart account
    const email = dto.user?.email ?? '';
    const [user] = await this.db.client
      .insert(users)
      .values({ email })
      .returning();

    await this.db.client.insert(smartAccounts).values({
      userId: user.id,
      gridAccountId: address,
    });

    const token = this.jwt.sign({ sub: user.id, gridAccountId: address });

    return { ...gridResponse, token };
  }

  // Login

  // Step 1: mobile sends email → Grid sends OTP
  async authenticate(email: string) {
    try {
      return await this.grid.initAuth(email);
    } catch (error) {
      this.handleGridError(error, 'authenticate');
    }
  }

  // Step 2: mobile sends OTP + sessionSecrets + user context
  async verifyOtp(dto: {
    otpCode: string;
    sessionSecrets: SessionSecrets;
    user: GridClientUserContext;
  }) {
    let gridResponse: CompleteAuthResponse;
    try {
      gridResponse = await this.grid.completeAuth({
        otpCode: dto.otpCode,
        sessionSecrets: dto.sessionSecrets,
        user: dto.user,
      });
    } catch (error) {
      this.handleGridError(error, 'verifyOtp');
    }

    const address = gridResponse.data.address;

    const [smartAccount] = await this.db.client
      .select()
      .from(smartAccounts)
      .where(eq(smartAccounts.gridAccountId, address))
      .limit(1);

    if (!smartAccount) throw new UnauthorizedException('Account not found');

    const token = this.jwt.sign({
      sub: smartAccount.userId,
      gridAccountId: address,
    });

    return { ...gridResponse, token };
  }

  // ── Passkeys ───────────────────────────────────────────────────────

  async checkPasskeys(accountAddress: string) {
    try {
      return await this.grid.getPasskeys(accountAddress);
    } catch (error) {
      this.handleGridError(error, 'checkPasskeys');
    }
  }

  async createPasskeySession(dto: {
    accountAddress: string;
    metaInfo: MetaInfo;
  }) {
    try {
      const sessionSecrets = await this.grid.generateSessionSecrets();
      const passkeySecret = sessionSecrets.find((s) => s.tag === 'passkey');
      if (!passkeySecret) {
        throw new HttpException(
          {
            code: 'PASSKEY_SESSION_FAILED',
            message: 'No passkey session key generated',
          },
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      console.log("passKeySecret", passkeySecret)

      const pubKey = new PublicKey(passkeySecret.publicKey)

      console.log("pubKey", pubKey)

      const sessionKey = this.grid.client.getSessionKeyObject(
        pubKey.toBase58(),
        '900',
      );

      console.log("sessionKey", sessionKey)

      return await this.grid.createPasskeySession({
        sessionKey,
        env: this.grid.getEnv(),
        metaInfo: dto.metaInfo,
      });
    } catch (error) {
      this.handleGridError(error, 'createPasskeySession');
    }
  }
}
