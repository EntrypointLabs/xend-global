import { Module } from '@nestjs/common';
import { RecoveryModule } from '../recovery/recovery.module';
import { JwtModule, JwtSecretRequestType } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { WalletModule } from '../wallet/wallet.module';
import { SolanaModule } from '../solana/solana.module';
import { CountersModule } from '../counters/counters.module';
import { DbModule } from '../db/db.module';
import { AccountEventsModule } from '../activity/account-events.module';
import { SignupService } from './signup.service';
import { SignupReaper } from './signup.reaper';
import { DrizzleSignupStore, SIGNUP_STORE } from './signup.store';
import { parseJwtKeyRing, secretForToken } from './jwt-secrets';

@Module({
  imports: [
    RecoveryModule,
    AccountEventsModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const ring = parseJwtKeyRing(config);
        return {
          secretOrKeyProvider: (requestType, tokenOrPayload) =>
            requestType === JwtSecretRequestType.VERIFY &&
            typeof tokenOrPayload === 'string'
              ? secretForToken(ring, tokenOrPayload)
              : ring.current.secret,
          signOptions: {
            expiresIn: config.get('JWT_EXPIRES_IN', '7d'),
            keyid: ring.current.kid,
          },
        };
      },
    }),
    // /auth/exchange needs the WalletProvider (PrivyAdapter) to verify
    // the incoming Privy ID token.
    WalletModule,
    // /auth/exchange registers each newly-minted wallet on the Helius
    // webhook subscription.
    SolanaModule,
    DbModule,
    // The unauthenticated sign-up endpoints are capped per IP as well as per
    // address, and the IP window lives in the shared rate counter.
    CountersModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    SignupService,
    SignupReaper,
    { provide: SIGNUP_STORE, useClass: DrizzleSignupStore },
  ],
  exports: [JwtStrategy],
})
export class AuthModule {}
