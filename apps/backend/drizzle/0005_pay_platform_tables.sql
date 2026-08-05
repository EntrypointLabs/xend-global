-- Adds the Pay platform domain: nine tables and five enums.
--
--   merchants, api_keys, payment_intents, payment_attempts, payments,
--   sessions, webhook_endpoints, webhook_deliveries, settlement_accounts.
--
-- Load-bearing structural guarantees:
--   payment_intents_merchant_idem_idx — replays of the same
--     (merchant_id, idempotency_key) return the existing intent. NULL
--     idempotency keys are distinct in Postgres, so keyless intents are
--     unconstrained.
--   payment_attempts_live_idx — at most one live attempt per intent; a
--     racing retry fails at the database, not in application logic.
--   payment_intents_expiry_idx — the expiry sweep scans only unauthorized
--     ('created') intents.
--   payments.refund_of_payment_id — self-FK linking a refund to the
--     Payment it reverses.
--   sessions.token_hash UNIQUE — opaque Session tokens are stored only as
--     their SHA-256 hash.
--
-- Amounts and FX rates are text (u64 / decimal strings), never numeric or
-- float columns, matching transfers.amount_raw.
--
-- Hand-authored to mirror schema.ts, following 0001/0002/0003: drizzle-kit
-- generate cannot serialize this schema (bigint().default(0n) on
-- tailer_state throws "Do not know how to serialize a BigInt"). This DDL is
-- authoritative; the schema.ts companion mirrors it exactly.

CREATE TYPE "public"."merchant_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."api_key_mode" AS ENUM('test', 'live');--> statement-breakpoint
CREATE TYPE "public"."payment_intent_status" AS ENUM('created', 'authorized', 'settling', 'succeeded', 'failed', 'expired', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."payment_attempt_status" AS ENUM('authorized', 'settling', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."webhook_delivery_status" AS ENUM('pending', 'succeeded', 'failed', 'exhausted');--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"status" "merchant_status" DEFAULT 'active' NOT NULL,
	"intent_ttl_minutes" integer,
	"allowed_origins" text[],
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"fingerprint" text NOT NULL,
	"mode" "api_key_mode" NOT NULL,
	"revoked_at" timestamp,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"consumer_id" text,
	"status" "payment_intent_status" DEFAULT 'created' NOT NULL,
	"usdc_settlement_raw" text NOT NULL,
	"ngn_display_minor" text,
	"fx_rate" text,
	"fx_source" text,
	"fx_quoted_at" timestamp,
	"merchant_reference" text,
	"idempotency_key" text,
	"expires_at" timestamp NOT NULL,
	"authorized_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"intent_id" text NOT NULL,
	"status" "payment_attempt_status" DEFAULT 'authorized' NOT NULL,
	"message_base64" text,
	"tx_signature" text,
	"blockhash" text,
	"failure_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_attempts_tx_signature_unique" UNIQUE("tx_signature")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"intent_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"consumer_id" text NOT NULL,
	"usdc_settlement_raw" text NOT NULL,
	"ngn_display_minor" text,
	"tx_signature" text,
	"settled_at" timestamp,
	"refund_of_payment_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payments_intent_id_unique" UNIQUE("intent_id"),
	CONSTRAINT "payments_tx_signature_unique" UNIQUE("tx_signature")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"consumer_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"issuing_intent_id" text,
	"ua_hint" text,
	"last_used_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"url" text NOT NULL,
	"secret_primary" text NOT NULL,
	"secret_secondary" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"event_types" text[],
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"endpoint_id" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" text NOT NULL,
	"correlation_id" text NOT NULL,
	"attempt_no" integer DEFAULT 1 NOT NULL,
	"response_status" integer,
	"response_body" text,
	"duration_ms" integer,
	"status" "webhook_delivery_status" DEFAULT 'pending' NOT NULL,
	"next_retry_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"address" text,
	"derivation_seed" text NOT NULL,
	"authority_address" text,
	"provisioned_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_accounts_merchant_id_unique" UNIQUE("merchant_id"),
	CONSTRAINT "settlement_accounts_address_unique" UNIQUE("address")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_consumer_id_users_id_fk" FOREIGN KEY ("consumer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_consumer_id_users_id_fk" FOREIGN KEY ("consumer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_refund_of_payment_id_payments_id_fk" FOREIGN KEY ("refund_of_payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_consumer_id_users_id_fk" FOREIGN KEY ("consumer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_issuing_intent_id_payment_intents_id_fk" FOREIGN KEY ("issuing_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_accounts" ADD CONSTRAINT "settlement_accounts_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_merchant_idx" ON "api_keys" USING btree ("merchant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_intents_merchant_idem_idx" ON "payment_intents" USING btree ("merchant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "payment_intents_expiry_idx" ON "payment_intents" USING btree ("expires_at") WHERE status = 'created';--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_live_idx" ON "payment_attempts" USING btree ("intent_id") WHERE status IN ('authorized', 'settling');--> statement-breakpoint
CREATE INDEX "payments_merchant_idx" ON "payments" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "payments_consumer_idx" ON "payments" USING btree ("consumer_id");--> statement-breakpoint
CREATE INDEX "sessions_consumer_idx" ON "sessions" USING btree ("consumer_id");--> statement-breakpoint
CREATE INDEX "sessions_merchant_consumer_idx" ON "sessions" USING btree ("merchant_id","consumer_id");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_merchant_idx" ON "webhook_endpoints" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_endpoint_idx" ON "webhook_deliveries" USING btree ("endpoint_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_event_idx" ON "webhook_deliveries" USING btree ("event_id");
