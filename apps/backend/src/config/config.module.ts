import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import * as Joi from 'joi';

/** Joi-validated env loader. */
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

        // Privy — server-side ID token verification.
        PRIVY_APP_ID: Joi.string().required(),
        PRIVY_APP_SECRET: Joi.string().required(),
        // PRIVY_VERIFICATION_KEY is optional: the SDK can fetch it from
        // Privy's JWKS endpoint on demand. Pin it for prod to avoid the
        // round-trip and to make verification offline-deterministic.
        PRIVY_VERIFICATION_KEY: Joi.string().optional().allow(''),

        // Solana RPC — Helius primary, public-devnet fallback. Keep this on
        // the same cluster as HELIUS_RPC_URL to avoid cross-cluster reads.
        HELIUS_API_KEY: Joi.string().required(),
        HELIUS_RPC_URL: Joi.string().uri().required(),
        SOLANA_PUBLIC_RPC_URL: Joi.string()
          .uri()
          .default('https://api.devnet.solana.com'),

        // Helius webhook control plane (RPC tailer).
        //   HELIUS_WEBHOOK_SECRET: shared secret used to authenticate
        //     incoming /webhooks/helius deliveries. Required for the
        //     webhook receiver to accept any traffic.
        //   HELIUS_WEBHOOK_ID: ID of the pre-created Helius webhook
        //     subscription. Optional at boot; ops creates it once via
        //     HeliusAdapter.bootstrapWebhook(...) and persists the
        //     returned ID. Without it, register/unregister throw.
        HELIUS_WEBHOOK_SECRET: Joi.string().required(),
        HELIUS_WEBHOOK_ID: Joi.string().optional().allow(''),

        // Stablecoin mints — backend computes the Balance sum over this
        // set server-side.
        EXPO_PUBLIC_USDT_MINT_ADDRESS: Joi.string().optional().allow(''),
        EXPO_PUBLIC_USDC_MINT_ADDRESS: Joi.string().optional().allow(''),
      }),
    }),
  ],
})
export class ConfigModule {}
