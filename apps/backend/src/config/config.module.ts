import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import * as Joi from 'joi';

export const USDC_MINT_BY_CLUSTER = {
  mainnet: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  devnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
} as const;

/** Joi-validated env loader. */
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        // No default: an environment that forgets to say what it is must not
        // silently get the development-only escape hatches below.
        NODE_ENV: Joi.string()
          .valid('development', 'production', 'test')
          .required(),
        PORT: Joi.number().default(8000),
        // Express trust-proxy setting: behind one load balancer in production
        // (so client IPs and rate limits come from X-Forwarded-For), off
        // everywhere else so a spoofed header cannot forge an address.
        TRUST_PROXY: Joi.alternatives()
          .try(Joi.boolean(), Joi.number().integer().min(0))
          .when('NODE_ENV', {
            is: 'production',
            then: Joi.any().default(1),
            otherwise: Joi.any().default(false),
          }),
        DATABASE_URL: Joi.string().required(),
        DB_POOL_MAX: Joi.number().integer().min(1).default(10),
        DB_CONNECTION_TIMEOUT_MS: Joi.number().integer().min(100).default(5000),
        DB_IDLE_TIMEOUT_MS: Joi.number().integer().min(1000).default(30000),
        // JWT_SECRETS is a comma list, signing secret first, every entry
        // verifying (the token header carries a kid). JWT_SECRET is the
        // single-key fallback; one of the two must be set.
        JWT_SECRETS: Joi.string().optional().allow(''),
        JWT_SECRET: Joi.string().when('JWT_SECRETS', {
          is: Joi.string().min(1),
          then: Joi.optional().allow(''),
          otherwise: Joi.required(),
        }),
        JWT_EXPIRES_IN: Joi.string().default('7d'),

        // Privy — server-side ID token verification.
        PRIVY_APP_ID: Joi.string().required(),
        PRIVY_APP_SECRET: Joi.string().required(),
        // PRIVY_VERIFICATION_KEY is optional: the SDK can fetch it from
        // Privy's JWKS endpoint on demand. Pin it for prod to avoid the
        // round-trip and to make verification offline-deterministic.
        PRIVY_VERIFICATION_KEY: Joi.string().optional().allow(''),

        // Turnkey — holds the approval signer (S2 in ADR 0025). Optional so a
        // deployment without a Turnkey organization still boots; enrolment is
        // the only thing that needs them, and it fails at the call site.
        //   TURNKEY_DELEGATED_PUBLIC_KEY is the backend's P-256 key. It is a
        //   root user only during enrolment and is narrowed out of the quorum
        //   before the sub-org is returned. See O6.
        TURNKEY_ORGANIZATION_ID: Joi.string().optional().allow(''),
        TURNKEY_API_PUBLIC_KEY: Joi.string().optional().allow(''),
        TURNKEY_API_PRIVATE_KEY: Joi.string().optional().allow(''),
        TURNKEY_DELEGATED_PUBLIC_KEY: Joi.string().optional().allow(''),
        TURNKEY_DELEGATED_PRIVATE_KEY: Joi.string().optional().allow(''),
        TURNKEY_API_BASE_URL: Joi.string()
          .uri()
          .default('https://api.turnkey.com'),
        // Writes program-allowlist policies onto each new S2 sub-organization.
        // Off until the policy bodies have been exercised against Turnkey.
        TURNKEY_POLICIES_ENABLED: Joi.boolean().default(false),

        // Seals the recovery signer's secret (S3). Optional for the same
        // reason as the Turnkey keys: recovery fails at the call, not at boot.
        //   env: AES-256-GCM under RECOVERY_VAULT_KEYS (id:base64 list,
        //     current first) or RECOVERY_VAULT_KEY as the single env-v1 key.
        //   aws-kms: envelope custody; each seal wraps a fresh data key from
        //     RECOVERY_VAULT_KMS_KEY_ID. Env keys still open old rows until
        //     scripts/reseal-recovery-signers.ts has moved them.
        RECOVERY_VAULT_PROVIDER: Joi.string()
          .valid('env', 'aws-kms')
          .default('env'),
        RECOVERY_VAULT_KEY: Joi.string().optional().allow(''),
        RECOVERY_VAULT_KEYS: Joi.string().optional().allow(''),
        RECOVERY_VAULT_KMS_KEY_ID: Joi.string().when(
          'RECOVERY_VAULT_PROVIDER',
          {
            is: 'aws-kms',
            then: Joi.required(),
            otherwise: Joi.optional().allow(''),
          },
        ),
        // Region for every KMS call; blank defers to the AWS SDK's own
        // AWS_REGION resolution. Credentials come from the standard chain.
        AWS_KMS_REGION: Joi.string().optional().allow(''),

        // Mail. Only recovery codes go out over this, and a deployment with no
        // key logs them instead, which MailModule refuses in production.
        RESEND_API_KEY: Joi.string().optional().allow(''),
        MAIL_FROM: Joi.string().default('Xend <security@xend.global>'),

        // App Attest audience: "TEAMID.bundleid". Attestation fails closed
        // without it, so an unset value blocks iOS enrolment rather than
        // waving it through.
        IOS_APP_ATTEST_APP_ID: Joi.string().optional().allow(''),

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
        // It must also be the canonical mint for SOLANA_CLUSTER: a devnet
        // mint on mainnet reads every Balance as zero, and the reverse
        // prices real money against a test token.
        EXPO_PUBLIC_USDT_MINT_ADDRESS: Joi.string().optional().allow(''),
        EXPO_PUBLIC_USDC_MINT_ADDRESS: Joi.string()
          .required()
          .when('SOLANA_CLUSTER', {
            is: 'mainnet',
            then: Joi.valid(USDC_MINT_BY_CLUSTER.mainnet),
            otherwise: Joi.valid(USDC_MINT_BY_CLUSTER.devnet),
          })
          .messages({
            'any.only':
              'EXPO_PUBLIC_USDC_MINT_ADDRESS must be the canonical USDC mint for SOLANA_CLUSTER',
          }),
        // Operator toggle: drop inbound Helius deliveries (acknowledged, not
        // processed) while the reconciler stays the only confirmation path.
        ACTIVITY_WEBHOOK_KILLSWITCH: Joi.boolean()
          .truthy('1')
          .falsy('0', '')
          .default(false),

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
        // A message whose handler keeps failing is parked on this topic after
        // this many attempts so it stops blocking its partition.
        KAFKA_DEAD_LETTER_TOPIC: Joi.string().default('events.dead-letter'),
        KAFKA_CONSUMER_MAX_ATTEMPTS: Joi.number().integer().min(1).default(5),

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
        // Authority custody: env reads the base58 secret; aws-kms reads its
        // KMS ciphertext and decrypts once at boot.
        SETTLEMENT_AUTHORITY_PROVIDER: Joi.string()
          .valid('env', 'aws-kms')
          .default('env'),
        SETTLEMENT_AUTHORITY_SECRET_KEY: Joi.string().when(
          'SETTLEMENT_AUTHORITY_PROVIDER',
          {
            is: 'env',
            then: Joi.required(),
            otherwise: Joi.optional().allow(''),
          },
        ),
        SETTLEMENT_AUTHORITY_SECRET_KEY_CIPHERTEXT: Joi.string().when(
          'SETTLEMENT_AUTHORITY_PROVIDER',
          {
            is: 'aws-kms',
            then: Joi.required(),
            otherwise: Joi.optional().allow(''),
          },
        ),
        // Fee-payer relayer deployable (internal network only). Optional:
        // nothing on the payment path calls it since settlement moved to the
        // Spend path (ADR 0026), so its client tolerates absent config and
        // fails at the call site instead of the boot.
        RELAYER_URL: Joi.string().uri().optional().allow(''),
        // MUST equal the relayer's RELAYER_INTERNAL_AUTH_SECRET (shared secret
        // on X-Relayer-Auth for /internal/*).
        RELAYER_INTERNAL_AUTH_SECRET: Joi.string().optional().allow(''),
        // The relayer fee-payer pubkey (tx payerKey).
        RELAYER_FEE_PAYER_ADDRESS: Joi.string().optional().allow(''),
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
        // A naira off-ramp that has heard nothing from the provider for this
        // long is failed by the reconciler so its Payment does not sit in
        // settling forever.
        SETTLEMENT_OFFRAMP_STUCK_MINUTES: Joi.number()
          .integer()
          .min(5)
          .default(120),

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
        // A delivery still pending this long after creation was orphaned by a
        // crash mid-attempt and is picked up by the retry sweep.
        WEBHOOK_PENDING_STALE_MINUTES: Joi.number()
          .integer()
          .min(1)
          .default(10),
        // How long the previous secret keeps signing after a rotation.
        WEBHOOK_SECRET_ROTATION_GRACE_HOURS: Joi.number()
          .integer()
          .min(1)
          .default(24),
        WEBHOOK_RESPONSE_BODY_MAX: Joi.number()
          .integer()
          .min(256)
          .default(2048),
        WEBHOOK_CONSUMER_GROUP: Joi.string().default('webhook-dispatcher'),

        // Test-only escape hatch so E2E can deliver to 127.0.0.1. MUST be
        // false (default) in every real environment: it disables the SSRF
        // private-range guard.
        WEBHOOK_ALLOW_PRIVATE_URLS: Joi.boolean().default(false),

        // Development-only: resolve a Payment to succeeded without building or
        // broadcasting a Spend, so local Checkout works with no Account on any
        // cluster and no funded authority.
        //
        // Turn it OFF to walk the real path locally once those exist: it is
        // what decides whether a Payment is routed through the Consumer's
        // Account at all, and with it on, an above-limit Payment is never
        // detected and Checkout never hands one to the app. Ignored outside
        // development, where the real path is the only path, and refused
        // outright in production so it cannot be reached by a misread NODE_ENV.
        CHECKOUT_DEV_FORCE_SETTLE: Joi.boolean()
          .default(false)
          .when('NODE_ENV', { is: 'production', then: Joi.valid(false) })
          .messages({
            'any.only': 'CHECKOUT_DEV_FORCE_SETTLE must be false in production',
          }),

        // Local test dashboard (mints Merchant API keys with no auth). The
        // module is not registered in production at all; elsewhere the guard
        // additionally requires this secret on x-test-dashboard-secret and
        // 404s when it is unset.
        TEST_DASHBOARD_SECRET: Joi.string().optional().allow(''),

        // Internal ops console (read-only, pilot). Unset = console disabled:
        // the guard denies every request when either value is missing.
        CONSOLE_USER: Joi.string().optional().allow(''),
        CONSOLE_PASSWORD: Joi.string().optional().allow(''),
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
        // The webhook receiver is only mounted when the leg is enabled, and
        // then the secret it verifies with is required at boot.
        BLOCKRADAR_WEBHOOK_SECRET: Joi.string().when(
          'BLOCKRADAR_SOLANA_NATIVE_ENABLED',
          {
            is: true,
            then: Joi.required(),
            otherwise: Joi.optional().allow(''),
          },
        ),
        BLOCKRADAR_MASTER_WALLET_ID: Joi.string().optional().allow(''),
        BLOCKRADAR_REFUND_SUPPORTED: Joi.boolean().default(false),
        BLOCKRADAR_SOLANA_NATIVE_ENABLED: Joi.boolean().default(false),
        // Operator toggle: acknowledge inbound off-ramp webhooks without
        // verifying, parsing, or writing.
        SETTLEMENT_WEBHOOK_KILLSWITCH: Joi.boolean()
          .truthy('1')
          .falsy('0', '')
          .default(false),

        // Observability. GET /metrics requires this as a bearer token when
        // set; unset, the route is open outside production and absent in it.
        METRICS_SECRET: Joi.string().optional().allow(''),
        // Tracing is on only when an OTLP/HTTP collector endpoint is given;
        // the SDK starts in main.ts before Nest loads.
        OTEL_EXPORTER_OTLP_ENDPOINT: Joi.string().uri().optional().allow(''),
        OTEL_SERVICE_NAME: Joi.string().default('xend-backend'),
      }),
    }),
  ],
})
export class ConfigModule {}
