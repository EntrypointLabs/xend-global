-- Blockradar settlement off-ramp read model (Phase 8). Adds the offramp_status
-- enum and the settlement_offramps table: the adapter's own off-ramp lifecycle
-- record (Phase 4 has no off-ramp table to write through). The partial-unique
-- index on signature WHERE direction = 'settlement' is the money-safety guard
-- that makes handleIncomingSettlement idempotent per signature so the
-- convert-payout cannot double-fire. Amounts/rates/spread are text (BigInt/
-- decimal strings), never float columns.
--
-- Hand-authored (drizzle-kit generate is unusable in this repo: it cannot
-- serialize bigint().default(0n) on tailer_state, and it prompts on TTY for
-- new enums). Repo convention since 0001/0002. Every statement is defensive
-- (IF NOT EXISTS / duplicate_object guard) so a re-run is a no-op.

DO $$ BEGIN
 CREATE TYPE "public"."offramp_status" AS ENUM('pending', 'swept', 'converting', 'paid', 'failed', 'reversing', 'reversed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settlement_offramps" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"payment_id" text,
	"provider" text NOT NULL,
	"signature" text,
	"provider_ref" text,
	"direction" text NOT NULL,
	"usdc_amount_raw" text NOT NULL,
	"ngn_amount_minor" text,
	"fx_rate" text,
	"fx_spread_raw" text,
	"status" "public"."offramp_status" DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_offramps_provider_ref_unique" UNIQUE("provider_ref")
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "settlement_offramps" ADD CONSTRAINT "settlement_offramps_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "settlement_offramps" ADD CONSTRAINT "settlement_offramps_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "settlement_offramps_merchant_idx" ON "settlement_offramps" USING btree ("merchant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "settlement_offramps_signature_idx" ON "settlement_offramps" USING btree ("signature") WHERE direction = 'settlement';
