-- Reshapes settlement_accounts from the interim single-authority shape
-- (migration 0004: derivation_seed NOT NULL, address, authority_address,
-- provisioned_at) into the polymorphic SettlementProvider endpoint
-- reference (ADR 0015): drops the v1 derivation_seed, adds provider /
-- currency / provider_reference / payout_config, and repurposes
-- authority_address as the attribution root. The table is a read model;
-- the chain is the source of truth.
--
-- Hand-authored (drizzle-kit generate is unusable in this repo: it cannot
-- serialize bigint().default(0n) on tailer_state, and it prompts on TTY
-- for the new enum). DEVIATION from the usual generate-only rule: every
-- statement is defensive (IF EXISTS / IF NOT EXISTS / duplicate_object
-- guard) because this migration crosses a superseded design and must
-- tolerate the v1 base or any partial state. The v2 columns (vehicle,
-- merchant_signer_address, control_address, attribution_ref) never landed
-- but are dropped-if-exists defensively.

DO $$ BEGIN
 CREATE TYPE "public"."settlement_provider" AS ENUM('direct_usdc', 'blockradar');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "settlement_accounts" DROP COLUMN IF EXISTS "derivation_seed";--> statement-breakpoint
ALTER TABLE "settlement_accounts" DROP COLUMN IF EXISTS "vehicle";--> statement-breakpoint
ALTER TABLE "settlement_accounts" DROP COLUMN IF EXISTS "merchant_signer_address";--> statement-breakpoint
ALTER TABLE "settlement_accounts" DROP COLUMN IF EXISTS "control_address";--> statement-breakpoint
ALTER TABLE "settlement_accounts" DROP COLUMN IF EXISTS "attribution_ref";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."settlement_vehicle";--> statement-breakpoint
ALTER TABLE "settlement_accounts" ADD COLUMN IF NOT EXISTS "provider" "public"."settlement_provider";--> statement-breakpoint
ALTER TABLE "settlement_accounts" ADD COLUMN IF NOT EXISTS "currency" text;--> statement-breakpoint
ALTER TABLE "settlement_accounts" ADD COLUMN IF NOT EXISTS "provider_reference" text;--> statement-breakpoint
ALTER TABLE "settlement_accounts" ADD COLUMN IF NOT EXISTS "payout_config" text;
