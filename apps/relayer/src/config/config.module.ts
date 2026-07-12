import { Module } from "@nestjs/common";
import { ConfigModule as NestConfigModule } from "@nestjs/config";
import * as Joi from "joi";

/**
 * Joi-validated env loader for the relayer. Fail-loud at boot: a missing
 * required var throws a Joi error naming the variable, matching the backend
 * posture. This is the relayer's OWN schema; the fee-payer key and the
 * relayer Helius credentials live here and NOWHERE in apps/backend.
 */
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid("development", "production", "test")
          .default("development"),
        PORT: Joi.number().default(8787),

        // Fee-payer key: base58 Ed25519 secret. RELAYER-ONLY. This variable
        // must never be added to apps/backend env or committed to the repo.
        RELAYER_FEE_PAYER_SECRET_KEY: Joi.string().required(),

        // Shared secret authenticating the internal co-sign channel. By
        // design this is also held by the Identity and Capability API caller
        // (wired there in Phase 4, not here).
        RELAYER_INTERNAL_AUTH_SECRET: Joi.string().required(),

        SOLANA_CLUSTER: Joi.string()
          .valid("devnet", "mainnet")
          .default("devnet"),

        // The relayer's OWN Helius access (its own key/url, not the
        // backend's). The URL embeds the API key, so it is never logged.
        RELAYER_HELIUS_RPC_URL: Joi.string().uri().required(),
        RELAYER_HELIUS_API_KEY: Joi.string().required(),
        RELAYER_SOLANA_PUBLIC_RPC_URL: Joi.string()
          .uri()
          .default("https://api.devnet.solana.com"),

        // Cluster-scoped USDC mint. The only mint the co-sign path accepts.
        USDC_MINT: Joi.string().required(),

        // Fee ceilings (decimal strings, parsed to bigint/number at boot).
        RELAYER_MAX_COMPUTE_UNIT_PRICE: Joi.string().default("1000000"),
        RELAYER_MAX_COMPUTE_UNITS: Joi.string().default("400000"),
        RELAYER_MAX_FEE_LAMPORTS_PER_TX: Joi.string().default("50000"),

        // Abuse caps.
        RELAYER_PER_CONSUMER_PAYMENTS_PER_HOUR: Joi.string().default("20"),
        RELAYER_PER_CONSUMER_FEE_LAMPORTS_PER_DAY:
          Joi.string().default("2000000"),
        RELAYER_PER_MERCHANT_PAYMENTS_PER_HOUR: Joi.string().default("500"),
        RELAYER_GLOBAL_FEE_LAMPORTS_PER_DAY: Joi.string().default("200000000"),

        // Balance alerting threshold in lamports (default 0.1 SOL).
        RELAYER_MIN_SOL_BALANCE_LAMPORTS: Joi.string().default("100000000"),

        // Optional best-effort alert sink (POSTed on low balance / spend
        // slope). Blank in local dev; a log line is always emitted.
        RELAYER_ALERT_WEBHOOK_URL: Joi.string().uri().optional().allow(""),
      }),
    }),
  ],
})
export class ConfigModule {}
