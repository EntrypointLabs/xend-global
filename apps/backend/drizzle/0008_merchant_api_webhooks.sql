-- Merchant API + webhooks + checkout HTTP + onboarding + refunds (Phase 6).
-- Adds the Stripe-semantics idempotency snapshot table, the ops-initiated
-- refunds table, the merchant KYB + pricing fields, the intent mode +
-- return/cancel URL columns, the webhook endpoint mode, and the webhook
-- delivery origin discriminator with its partial unique index (so
-- at-least-once Kafka re-consume materializes at most one automatic delivery
-- per endpoint+event while manual redeliveries stay exempt).
--
-- Hand-authored (drizzle-kit generate is unusable in this repo: it cannot
-- serialize bigint().default(0n) on tailer_state, and it prompts on TTY for
-- new enums). Repo convention since 0001/0002. Every statement is defensive
-- (IF NOT EXISTS / duplicate_object guard) so a re-run is a no-op.

DO $$ BEGIN
 CREATE TYPE "public"."webhook_delivery_origin" AS ENUM('event', 'manual');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."kyb_status" AS ENUM('pending', 'verified', 'rejected');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."refund_status" AS ENUM('pending', 'processing', 'succeeded', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "idempotency_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"status" "public"."refund_status" DEFAULT 'pending' NOT NULL,
	"amount_usdc_raw" text NOT NULL,
	"reason" text,
	"provider_reference" text,
	"idempotency_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "refunds" ADD CONSTRAINT "refunds_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "kyb_status" "public"."kyb_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "kyb_verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "flat_fee_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "fx_spread_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD COLUMN IF NOT EXISTS "mode" "public"."api_key_mode" DEFAULT 'test' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD COLUMN IF NOT EXISTS "return_url" text;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD COLUMN IF NOT EXISTS "cancel_url" text;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD COLUMN IF NOT EXISTS "mode" "public"."api_key_mode" DEFAULT 'test' NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN IF NOT EXISTS "origin" "public"."webhook_delivery_origin" DEFAULT 'event' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idempotency_keys_merchant_key_idx" ON "idempotency_keys" USING btree ("merchant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refunds_payment_idx" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_deliveries_auto_idx" ON "webhook_deliveries" USING btree ("endpoint_id","event_id") WHERE origin = 'event';
