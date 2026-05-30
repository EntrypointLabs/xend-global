import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import * as Joi from 'joi';

/**
 * ConfigModule — Joi-validated env loader.
 *
 * Phase 5 removed GRID_API_KEY: the backend Grid module is gone and the
 * mobile KYC flow now talks directly to Grid via the mobile-side
 * `@sqds/grid-react-native` SDK inside the expo-router BFF (kyc+api.ts /
 * kyc-status+api.ts). Until the KYC swarm replaces Grid with Sumsub, those
 * routes read GRID_API_KEY from `apps/mobile/.env` exclusively.
 *
 * Env vars consumed here:
 *   - PRIVY_APP_ID / PRIVY_APP_SECRET / PRIVY_VERIFICATION_KEY
 *     consumed by PrivyAdapter (apps/backend/src/wallet/privy.adapter.ts).
 *   - HELIUS_API_KEY / HELIUS_RPC_URL consumed by HeliusAdapter.
 *   - SOLANA_PUBLIC_RPC_URL consumed by PublicMainnetAdapter (failover).
 *   - EXPO_PUBLIC_USDT_MINT_ADDRESS lives here (not in mobile/.env)
 *     because the backend wallet balance summary computes the stablecoin
 *     total server-side (spec §5.5).
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

        // Helius webhook control plane (Phase 2 — RPC tailer).
        //   HELIUS_WEBHOOK_SECRET: shared secret used to authenticate
        //     incoming /webhooks/helius deliveries. Required for the
        //     webhook receiver to accept any traffic.
        //   HELIUS_WEBHOOK_ID: ID of the pre-created Helius webhook
        //     subscription. Optional at boot; ops creates it once via
        //     HeliusAdapter.bootstrapWebhook(...) and persists the
        //     returned ID. Without it, register/unregister throw.
        HELIUS_WEBHOOK_SECRET: Joi.string().required(),
        HELIUS_WEBHOOK_ID: Joi.string().optional().allow(''),

        // Stablecoin mints (Phase 1) — backend computes the Balance sum
        // over this set per spec §5.5.
        EXPO_PUBLIC_USDT_MINT_ADDRESS: Joi.string().optional().allow(''),
        EXPO_PUBLIC_USDC_MINT_ADDRESS: Joi.string().optional().allow(''),
      }),
    }),
  ],
})
export class ConfigModule {}
