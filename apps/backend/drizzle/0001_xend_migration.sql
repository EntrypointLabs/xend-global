-- DESTRUCTIVE on dev databases. PRs that include this migration MUST
-- call out the destruction in the description so a future engineer
-- running the migration on a populated dev DB knows what to expect.
--
-- The smart_accounts address column is renamed in place (no copy)
-- because the address SHAPE is identical (Solana base58 pubkey); only
-- the SEMANTIC owner changes.
--
-- provider_user_id is NOT NULL UNIQUE and there is no value to backfill
-- a pre-existing row with, so any leftover rows are deleted before
-- adding the constraint. The user row is preserved (they can re-sign-in).

DELETE FROM transactions;
DELETE FROM smart_accounts;

CREATE TYPE "public"."wallet_provider" AS ENUM ('privy');--> statement-breakpoint

ALTER TABLE "smart_accounts" RENAME COLUMN "grid_account_id" TO "wallet_address";--> statement-breakpoint
ALTER TABLE "smart_accounts" RENAME CONSTRAINT "smart_accounts_grid_account_id_unique" TO "smart_accounts_wallet_address_unique";--> statement-breakpoint

ALTER TABLE "smart_accounts" ADD COLUMN "provider" "wallet_provider" NOT NULL DEFAULT 'privy';--> statement-breakpoint
ALTER TABLE "smart_accounts" ADD COLUMN "provider_user_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "smart_accounts" ADD CONSTRAINT "smart_accounts_provider_user_id_unique" UNIQUE ("provider_user_id");--> statement-breakpoint

ALTER TABLE "transactions" RENAME TO "transfers";--> statement-breakpoint
ALTER TABLE "transfers" RENAME CONSTRAINT "transactions_signature_unique" TO "transfers_signature_unique";--> statement-breakpoint
ALTER TABLE "transfers" RENAME CONSTRAINT "transactions_smart_account_id_smart_accounts_id_fk" TO "transfers_smart_account_id_smart_accounts_id_fk";--> statement-breakpoint

CREATE TYPE "public"."transfer_direction" AS ENUM ('SEND', 'RECEIVE');--> statement-breakpoint
CREATE TYPE "public"."transfer_status" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');--> statement-breakpoint

-- Add the new columns nullable first so we can populate / migrate, then
-- tighten constraints below.
ALTER TABLE "transfers" ADD COLUMN "intent_id" text;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "direction" "transfer_direction";--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "mint" text;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "amount_raw" text;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "submitted_at" timestamp;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "failure_reason" text;--> statement-breakpoint

ALTER TABLE "transfers" ADD CONSTRAINT "transfers_intent_id_unique" UNIQUE ("intent_id");--> statement-breakpoint

-- The old and new status enums have identical values; cast to text then
-- to the new enum so the underlying data is preserved.
ALTER TABLE "transfers" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "transfers"
  ALTER COLUMN "status" TYPE "transfer_status" USING "status"::text::"transfer_status";--> statement-breakpoint
ALTER TABLE "transfers" ALTER COLUMN "status" SET DEFAULT 'PENDING';--> statement-breakpoint

-- The table had no rows after the DELETE above, so the empty table
-- accepts SET NOT NULL on the new columns immediately. The application
-- write site must always populate them.
ALTER TABLE "transfers" DROP COLUMN "type";--> statement-breakpoint
ALTER TABLE "transfers" DROP COLUMN "token";--> statement-breakpoint
ALTER TABLE "transfers" DROP COLUMN "amount";--> statement-breakpoint

ALTER TABLE "transfers" ALTER COLUMN "direction" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transfers" ALTER COLUMN "mint" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transfers" ALTER COLUMN "amount_raw" SET NOT NULL;--> statement-breakpoint

DROP TYPE "public"."tx_type";--> statement-breakpoint
DROP TYPE "public"."tx_status";
