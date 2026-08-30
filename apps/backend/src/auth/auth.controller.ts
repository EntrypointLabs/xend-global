import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import {
  AuthService,
  CredentialConflictError,
  EmailInUseError,
} from './auth.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RecoveryChallengeService } from '../recovery/recovery-challenge.service';
import {
  ChallengeAttemptsExhaustedError,
  InvalidRecoveryCodeError,
  NoRecoveryChallengeError,
  RecoveryGrantExpiredError,
  TooManyRecoveryCodesError,
} from '../recovery/recovery.errors';
import {
  ExchangeRequestSchema,
  MirrorPasskeyCredentialSchema,
  RequestEmailCodeSchema,
  SetEmailSchema,
  SignupEmailChallengeSchema,
  SignupEmailSchema,
  type ExchangeRequest,
  type MirrorPasskeyCredentialRequest,
  type RequestEmailCodeRequest,
  type SetEmailRequest,
  type SignupEmailChallengeRequest,
  type SignupEmailRequest,
} from './dtos';
import { SignupService } from './signup.service';
import { TooManySignupAttemptsError } from './signup.errors';

interface AuthenticatedRequest extends Request {
  user: { userId: string; walletAddress: string };
}

@Controller()
export class AuthController {
  constructor(
    private auth: AuthService,
    private challenges: RecoveryChallengeService,
    private signup: SignupService,
  ) {}

  @Post('auth/exchange')
  exchange(
    @Body(new ZodValidationPipe(ExchangeRequestSchema)) dto: ExchangeRequest,
  ) {
    return this.auth.exchange(dto.privyIdToken, dto.signupToken);
  }

  /**
   * The first step of sign-up: a code to the address the Consumer will be
   * reached at. No session yet, so the answer never says whether the address
   * is already on an Account.
   */
  @Post('auth/signup/email/challenge')
  async requestSignupCode(
    @Req() req: Request,
    @Body(new ZodValidationPipe(SignupEmailChallengeSchema))
    dto: SignupEmailChallengeRequest,
  ) {
    try {
      return await this.signup.startEmailSignup(dto.email, clientIp(req));
    } catch (err) {
      throw toEmailHttp(err);
    }
  }

  /** Proves the address and hands back the token the passkey step carries. */
  @Post('auth/signup/email')
  async verifySignupCode(
    @Req() req: Request,
    @Body(new ZodValidationPipe(SignupEmailSchema)) dto: SignupEmailRequest,
  ) {
    try {
      return await this.signup.verifyEmailSignup(
        dto.email,
        dto.code,
        clientIp(req),
      );
    } catch (err) {
      throw toEmailHttp(err);
    }
  }

  /**
   * Sends a code to an address a Consumer is claiming.
   *
   * The conflict check runs before the mail does, so an address already on
   * another Account is refused rather than answered with a code sent to
   * somebody else's inbox.
   */
  @Post('auth/email/challenge')
  @UseGuards(AuthGuard('jwt'))
  async requestEmailCode(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(RequestEmailCodeSchema))
    dto: RequestEmailCodeRequest,
  ) {
    const email = dto.email.trim().toLowerCase();
    try {
      await this.auth.assertEmailClaimable(req.user.userId, email);
      const { expiresAt } = await this.challenges.issue(
        req.user.userId,
        email,
        'contact_verification',
      );
      return { sent: true, expiresAt: expiresAt.toISOString() };
    } catch (err) {
      throw toEmailHttp(err);
    }
  }

  /** Records the contact address, against the grant that proved it. */
  @Post('auth/email')
  @UseGuards(AuthGuard('jwt'))
  async setEmail(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(SetEmailSchema)) dto: SetEmailRequest,
  ) {
    try {
      const { grantId } = await this.challenges.verify(
        req.user.userId,
        'contact_verification',
        dto.code,
      );
      const grant = await this.challenges.assertGrant(
        req.user.userId,
        grantId,
        'contact_verification',
      );
      // The code proves one address. Writing a different one against it would
      // let a Consumer prove an inbox they hold and then anchor S3 elsewhere.
      if (grant.target !== dto.email) {
        throw new RecoveryGrantExpiredError(
          'that code was sent to a different address',
        );
      }
      const saved = await this.auth.setEmail(req.user.userId, dto.email);
      await this.challenges.consume(grantId);
      return saved;
    } catch (err) {
      throw toEmailHttp(err);
    }
  }

  /**
   * Mirror a freshly enrolled passkey credential for the authenticated
   * Consumer. Cross-account credential claims map to 409 CREDENTIAL_CONFLICT.
   */
  @Post('auth/passkey-credentials')
  @UseGuards(AuthGuard('jwt'))
  async mirrorPasskeyCredential(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(MirrorPasskeyCredentialSchema))
    dto: MirrorPasskeyCredentialRequest,
  ) {
    try {
      return await this.auth.mirrorPasskeyCredential(req.user.userId, dto);
    } catch (err) {
      if (err instanceof CredentialConflictError) {
        throw new HttpException(
          { code: err.code, message: err.message },
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
  }
}

/**
 * Maps the refusals a contact address can produce.
 *
 * Each one means something different to the Consumer: pick another address,
 * wait, type it again, or start over. Flattening them into one error would
 * leave the screen with nothing useful to say.
 */
function toEmailHttp(err: unknown): HttpException {
  if (err instanceof EmailInUseError) {
    return new HttpException(
      { code: err.code, message: err.message },
      HttpStatus.CONFLICT,
    );
  }
  if (
    err instanceof InvalidRecoveryCodeError ||
    err instanceof NoRecoveryChallengeError
  ) {
    return new HttpException(
      { code: err.code, message: err.message },
      HttpStatus.UNAUTHORIZED,
    );
  }
  if (
    err instanceof TooManyRecoveryCodesError ||
    err instanceof TooManySignupAttemptsError
  ) {
    return new HttpException(
      { code: err.code, message: err.message },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
  if (
    err instanceof ChallengeAttemptsExhaustedError ||
    err instanceof RecoveryGrantExpiredError
  ) {
    return new HttpException(
      { code: err.code, message: err.message },
      HttpStatus.CONFLICT,
    );
  }
  return err instanceof HttpException
    ? err
    : new HttpException(
        { code: 'EMAIL_UPDATE_FAILED', message: 'could not save that address' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
}

/**
 * Express fills `req.ip` from the socket, or from X-Forwarded-For when the
 * app trusts its proxy. Behind one that is not trusted every caller shares
 * the proxy's address and the per-IP cap becomes a global one.
 */
function clientIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}
