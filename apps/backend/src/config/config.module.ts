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

        // Settlement provider layer (ADR 0015). Active cluster for the
        // settlement money-moving code; devnet backs test mode end-to-end.
        SOLANA_CLUSTER: Joi.string()
          .valid('devnet', 'mainnet')
          .default('devnet'),
        // base58 Ed25519 secret key. Owns the direct-USDC pilot settlement
        // token account, signs refunds (reverse()) out of it, and is the
        // pilot attribution root. Sensitive: follows the same custody order
        // as the relayer fee-payer key (KMS/Turnkey signer > cloud-KMS-wrapped
        // key > raw env at pilot floor). Never logged. The Blockradar master
        // wallet + payout credentials are a Phase 8 concern, not added here.
        SETTLEMENT_AUTHORITY_SECRET_KEY: Joi.string().required(),
        // Phase 3 relayer deployable base URL (internal network only).
        RELAYER_URL: Joi.string().uri().required(),
        // MUST equal the relayer's RELAYER_INTERNAL_AUTH_SECRET (shared secret
        // on X-Relayer-Auth for /internal/*).
        RELAYER_INTERNAL_AUTH_SECRET: Joi.string().required(),
        // The relayer fee-payer pubkey (tx payerKey). Verified against the
        // relayer's GET /health at the phase checkpoint; drift silently breaks
        // every settlement.
        RELAYER_FEE_PAYER_ADDRESS: Joi.string().required(),
        // Active confirmation poll cadence and ceiling (hot path). The poll
        // races the Helius webhook; the 30s sweep is the tail safety net.
        SETTLEMENT_CONFIRM_POLL_INTERVAL_MS: Joi.number()
          .integer()
          .min(100)
          .default(500),
        SETTLEMENT_CONFIRM_BUDGET_MS: Joi.number()
          .integer()
          .min(1000)
          .default(8000),

        // Internal ops surface (webhook endpoint registration, manual
        // redelivery). Not a merchant credential; not the consumer JWT.
        INTERNAL_API_SECRET: Joi.string().required(),

        // FX: off-ramp partner executable quote, pinned at intent creation.
        // FX_PARTNER_QUOTE_URL absent -> pilot uses FX_PILOT_STATIC_RATE
        // (devnet). Staleness cap: reject creation if no fresh-or-cached
        // quote inside the window rather than misprice.
        FX_PARTNER_QUOTE_URL: Joi.string().uri().optional().allow(''),
        FX_PILOT_STATIC_RATE: Joi.string()
          .pattern(/^\d+(\.\d+)?$/)
          .default('1600.00'),
        FX_RATE_DECIMALS: Joi.number().integer().min(2).max(12).default(6),
        FX_STALENESS_CAP_SECONDS: Joi.number().integer().min(1).default(900),
        FX_QUOTE_TIMEOUT_MS: Joi.number().integer().min(200).default(3000),

        // Checkout HTTP surface: session cookie + signed return URLs
        // (redirect-completion mode).
        CHECKOUT_RETURN_URL_SECRET: Joi.string().required(),
        CHECKOUT_RETURN_URL_TTL_SECONDS: Joi.number()
          .integer()
          .min(60)
          .default(900),
        CHECKOUT_SESSION_COOKIE: Joi.string().default('xend_checkout_session'),

        // Outbound webhooks.
        WEBHOOK_DELIVERY_TIMEOUT_MS: Joi.number()
          .integer()
          .min(1000)
          .default(10000),
        WEBHOOK_MAX_ATTEMPTS: Joi.number().integer().min(1).default(12),
        WEBHOOK_RETRY_BASE_SECONDS: Joi.number().integer().min(1).default(30),
        WEBHOOK_RETRY_MAX_SECONDS: Joi.number().integer().min(1).default(21600),
        WEBHOOK_REPLAY_TOLERANCE_SECONDS: Joi.number()
          .integer()
          .min(30)
          .default(300),
        WEBHOOK_RESPONSE_BODY_MAX: Joi.number()
          .integer()
          .min(256)
          .default(2048),
        WEBHOOK_CONSUMER_GROUP: Joi.string().default('webhook-dispatcher'),

        // Test-only escape hatch so E2E can deliver to 127.0.0.1. MUST be
        // false (default) in every real environment: it disables the SSRF
        // private-range guard.
        WEBHOOK_ALLOW_PRIVATE_URLS: Joi.boolean().default(false),

        // Blockradar naira settlement adapter (ADR 0019, Phase 8). The three
        // Solana confirmations are UNCONFIRMED against docs.blockradar.co
        // (Flag #2), so the leg ships STUBBED OFF: BLOCKRADAR_SOLANA_NATIVE_ENABLED
        // (default false) gates the real off-ramp/reverse calls, and the creds
        // stay OPTIONAL until it is flipped on — the adapter fails loud at boot
        // only when enabled, so requiring them here would break boot for the
        // USDC-only pilot. BLOCKRADAR_REFUND_SUPPORTED defaults false because
        // confirmation (c) (per-Merchant reverse) is unconfirmed, so Phase 6's
        // capability gate keeps naira refunds at REFUND_NOT_SUPPORTED (manual-ops).
        BLOCKRADAR_API_KEY: Joi.string().optional().allow(''),
        BLOCKRADAR_WEBHOOK_SECRET: Joi.string().optional().allow(''),
        BLOCKRADAR_MASTER_WALLET_ID: Joi.string().optional().allow(''),
        BLOCKRADAR_REFUND_SUPPORTED: Joi.boolean().default(false),
        BLOCKRADAR_SOLANA_NATIVE_ENABLED: Joi.boolean().default(false),
      }),
    }),
  ],
})
export class ConfigModule {}
