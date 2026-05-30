import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { WalletModule } from '../wallet/wallet.module';
import { SolanaModule } from '../solana/solana.module';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow('JWT_SECRET'),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN', '7d') },
      }),
    }),
    // Phase 1: /auth/exchange needs the WalletProvider (PrivyAdapter) to
    // verify the incoming Privy ID token. The legacy /verify-otp* path
    // keeps using GridService and is untouched.
    WalletModule,
    // Phase 2: /auth/exchange registers each newly-minted wallet on the
    // Helius webhook subscription (best-effort; failure is logged but
    // does not block the auth response — reconciler is the safety net).
    SolanaModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [JwtStrategy],
})
export class AuthModule {}
