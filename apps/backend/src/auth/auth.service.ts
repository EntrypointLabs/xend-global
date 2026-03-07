import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { GridService } from '../grid/grid.service';
import { DbService } from '../db/db.service';
import { users, smartAccounts } from '../db/schema';
import { eq } from 'drizzle-orm';
import { SessionSecrets } from '@sqds/grid';

@Injectable()
export class AuthService {
    constructor(
        private grid: GridService,
        private jwt: JwtService,
        private db: DbService,
    ) {}

    // Registration

    // Step 1: mobile sends email - Grid sends OTP
    async register(email: string) {
        return this.grid.createAccount(email);
        // Returns Grid's response with user context mobile needs for step 2
    }

    // Step 2: mobile sends OTP + sessionSecrets + user context
    // Grid creates the smart account automatically with Turnkey MPC
    async verifyOtpAndCreateAccount(dto: {
        otpCode: string;
        sessionSecrets: SessionSecrets;
        user: any;
    }) {
        const gridResponse = await this.grid.completeAuthAndCreateAccount({
            otpCode:        dto.otpCode,
            sessionSecrets: dto.sessionSecrets,
            user:           dto.user,
        });

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
                sub:          existingAccount[0].userId,
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
            userId:        user.id,
            gridAccountId: address,
        });

        const token = this.jwt.sign({ sub: user.id, gridAccountId: address });

        return { ...gridResponse, token };
    }

    // Login

    // Step 1: mobile sends email → Grid sends OTP
    async authenticate(email: string) {
        return this.grid.initAuth(email);
        // Returns Grid's user context mobile needs for step 2
    }

    // Step 2: mobile sends OTP + sessionSecrets + user context
    async verifyOtp(dto: {
        otpCode: string;
        sessionSecrets: SessionSecrets;
        user: any;
    }) {
        const gridResponse = await this.grid.completeAuth({
            otpCode:        dto.otpCode,
            sessionSecrets: dto.sessionSecrets,
            user:           dto.user,
        });

        const address = gridResponse.data.address;

        const [smartAccount] = await this.db.client
            .select()
            .from(smartAccounts)
            .where(eq(smartAccounts.gridAccountId, address))
            .limit(1);

        if (!smartAccount) throw new UnauthorizedException('Account not found');

        const token = this.jwt.sign({
            sub:           smartAccount.userId,
            gridAccountId: address,
        });

        return { ...gridResponse, token };
    }
}