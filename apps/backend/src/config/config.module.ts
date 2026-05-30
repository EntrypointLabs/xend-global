import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import * as Joi from 'joi';

/**
 * ConfigModule — Joi-validated env loader.
 *
 * Phase 1 additions (Privy + Helius + Solana RPC strategy):
 *   - PRIVY_APP_ID / PRIVY_APP_SECRET / PRIVY_VERIFICATION_KEY
 *     consumed by PrivyAdapter (apps/backend/src/wallet/privy.adapter.ts).
 *   - HELIUS_API_KEY / HELIUS_RPC_URL consumed by HeliusAdapter.
 *   - SOLANA_PUBLIC_RPC_URL consumed by PublicMainnetAdapter (failover).
 *   - EXPO_PUBLIC_USDT_MINT_ADDRESS lives here (not in mobile/.env)
 *     because the backend wallet balance summary computes the stablecoin
 *     total server-side (spec §5.5).
 *
 * GRID_API_KEY stays required while the legacy /register, /auth, and
 * /verify-otp* endpoints are still wired in (Phase 5 deletes them).
 */
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid('development', 'production', 'test')
          .default('development'),
        PORT: Joi.number().default(8000),
        DATABASE_URL: Joi.string().required(),
        GRID_API_KEY: Joi.string().required(),
        JWT_SECRET: Joi.string().required(),
        JWT_EXPIRES_IN: Joi.string().default('7d'),

        // Privy (Phase 1) — server-side ID token verification.
        PRIVY_APP_ID: Joi.string().required(),
        PRIVY_APP_SECRET: Joi.string().required(),
        // PRIVY_VERIFICATION_KEY is optional: the SDK can fetch it from
        // Privy's JWKS endpoint on demand. Pin it for prod to avoid the
        // round-trip and to make verification offline-deterministic.
        PRIVY_VERIFICATION_KEY: Joi.string().optional().allow(''),

        // Solana RPC (Phase 1) — Helius primary, public-mainnet fallback.
        HELIUS_API_KEY: Joi.string().required(),
        HELIUS_RPC_URL: Joi.string().uri().required(),
        SOLANA_PUBLIC_RPC_URL: Joi.string()
          .uri()
          .default('https://api.mainnet-beta.solana.com'),

        // Stablecoin mints (Phase 1) — backend computes the Balance sum
        // over this set per spec §5.5.
        EXPO_PUBLIC_USDT_MINT_ADDRESS: Joi.string().optional().allow(''),
      }),
    }),
  ],
})
export class ConfigModule {}
