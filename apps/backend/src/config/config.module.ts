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
        // set server-side. USDC is required and non-empty: the capacity
        // engine reads live USDC Balance for every money decision, so a
        // present-but-empty value must fail at boot rather than read zero.
        EXPO_PUBLIC_USDT_MINT_ADDRESS: Joi.string().optional().allow(''),
        EXPO_PUBLIC_USDC_MINT_ADDRESS: Joi.string().required(),

        // Redis: Session and rate-limit state (managed in cloud, docker-compose
        // locally). rediss:// for TLS-terminated managed instances.
        REDIS_URL: Joi.string()
          .uri({ scheme: ['redis', 'rediss'] })
          .required(),

        // Kafka: payment lifecycle events (see ADR 0012 for the topic catalog).
        // KAFKA_BROKERS is a comma-separated host:port list. SASL vars stay
        // blank for local docker-compose; managed brokers require them.
        KAFKA_BROKERS: Joi.string().required(),
        KAFKA_CLIENT_ID: Joi.string().default('xend-backend'),
        KAFKA_SSL: Joi.boolean().default(false),
        KAFKA_SASL_MECHANISM: Joi.string()
          .valid('plain', 'scram-sha-256', 'scram-sha-512')
          .default('plain'),
        KAFKA_SASL_USERNAME: Joi.string().optional().allow(''),
        KAFKA_SASL_PASSWORD: Joi.string().optional().allow(''),

        // Capacity tiers: JSON table of tier bands; amounts are raw u64
        // strings in USDC minor units. Pilot default: 50 USDC per payment,
        // 200/day, 1000/month. Tunable without a code change.
        CAPACITY_TIERS: Joi.string().default(
          '{"tier0":{"perPaymentMaxRaw":"50000000","dailyCapRaw":"200000000","monthlyCapRaw":"1000000000"}}',
        ),
        CAPACITY_DEFAULT_TIER: Joi.string().default('tier0'),

        // Payment intent TTL: how long an unauthorized intent stays payable.
        // Merchants can override per row (merchants.intent_ttl_minutes).
        PAYMENT_INTENT_TTL_MINUTES: Joi.number()
          .integer()
          .min(5)
          .max(1440)
          .default(60),

        // Session policy: opaque merchant-scoped tokens. Values are
        // tunable without a code change; velocity caps must sit at or
        // below tier caps (enforced at boot).
        SESSION_ABSOLUTE_TTL_DAYS: Joi.number().integer().min(1).default(90),
        SESSION_SLIDING_WINDOW_DAYS: Joi.number().integer().min(1).default(30),
        SESSION_VELOCITY_MAX_PAYMENTS_PER_DAY: Joi.number()
          .integer()
          .min(1)
          .default(5),
        SESSION_VELOCITY_MAX_AMOUNT_RAW_PER_DAY: Joi.string()
          .pattern(/^\d+$/)
          .default('100000000'),

        // CORS: browser origins allowed to call this API. The mobile app is
        // not a browser and is unaffected. pay.xend.global is the Checkout
        // surface; localhost entries cover local web dev.
        CORS_ALLOWED_ORIGINS: Joi.string().default('https://pay.xend.global'),
      }),
    }),
  ],
})
export class ConfigModule {}
