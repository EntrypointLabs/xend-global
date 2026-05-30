-- 0001_xend_migration.sql — Phase 1: Grid -> Privy schema reshape.
--
-- DESTRUCTIVE on dev databases. Greenfield assumption holds (the product
-- has not gone live; no Consumer funds on the Grid stack). PRs that
-- include this migration MUST call out the destruction in the
-- description so a future engineer running the migration on a populated
-- dev DB knows what to expect.
--
-- What changes:
--   1. smart_accounts: grid_account_id -> wallet_address; add provider
--      (enum 'privy') + provider_user_id (UNIQUE NOT NULL). The old
--      column is renamed in place (no copy) because the address SHAPE is
--      identical (Solana base58 pubkey); only the SEMANTIC owner changes.
--   2. transactions -> transfers: rename + reshape per spec section 5.4.
--      Old columns (type, token, amount) map to new columns (direction,
--      mint, amount_raw). New columns: intent_id (idempotency key),
--      submitted_at, failure_reason.
--   3. Drop the old tx_type, tx_status enums after the columns that
--      used them are gone.
--
-- Pre-migration: dev DB carries 1 leftover smart_accounts row from the
-- Grid era. provider_user_id is NOT NULL UNIQUE and we have no Privy DID
-- to backfill it with, so we delete the row before adding the
-- constraint. The user row is preserved (they can re-sign-in via Privy).
-- This DELETE is dev-only safe because no real Consumer data exists.
--
-- Spec: docs/specs/migration-already-built-features.md sections 5.1, 5.4, 5.5.
-- Plan: .claude/plans/xend-grid-migration/phases/phase-1-backend-wallet-plumbing/PLAN.md

-- ── 0. Clear pre-existing rows (dev only; greenfield) ───────────────
DELETE FROM transactions;
DELETE FROM smart_accounts;

-- ── 1. smart_accounts reshape ──────────────────────────────────────
CREATE TYPE "public"."wallet_provider" AS ENUM ('privy');--> statement-breakpoint

ALTER TABLE "smart_accounts" RENAME COLUMN "grid_account_id" TO "wallet_address";--> statement-breakpoint
ALTER TABLE "smart_accounts" RENAME CONSTRAINT "smart_accounts_grid_account_id_unique" TO "smart_accounts_wallet_address_unique";--> statement-breakpoint

ALTER TABLE "smart_accounts" ADD COLUMN "provider" "wallet_provider" NOT NULL DEFAULT 'privy';--> statement-breakpoint
ALTER TABLE "smart_accounts" ADD COLUMN "provider_user_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "smart_accounts" ADD CONSTRAINT "smart_accounts_provider_user_id_unique" UNIQUE ("provider_user_id");--> statement-breakpoint

-- ── 2. transactions -> transfers ───────────────────────────────────
ALTER TABLE "transactions" RENAME TO "transfers";--> statement-breakpoint
ALTER TABLE "transfers" RENAME CONSTRAINT "transactions_signature_unique" TO "transfers_signature_unique";--> statement-breakpoint
ALTER TABLE "transfers" RENAME CONSTRAINT "transactions_smart_account_id_smart_accounts_id_fk" TO "transfers_smart_account_id_smart_accounts_id_fk";--> statement-breakpoint

CREATE TYPE "public"."transfer_direction" AS ENUM ('SEND', 'RECEIVE');--> statement-breakpoint
CREATE TYPE "public"."transfer_status" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');--> statement-breakpoint

-- Add the new columns nullable first so we can populate / migrate, then
-- tighten constraints.
ALTER TABLE "transfers" ADD COLUMN "intent_id" text;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "direction" "transfer_direction";--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "mint" text;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "amount_raw" text;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "submitted_at" timestamp;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "failure_reason" text;--> statement-breakpoint

ALTER TABLE "transfers" ADD CONSTRAINT "transfers_intent_id_unique" UNIQUE ("intent_id");--> statement-breakpoint

-- ── 3. Convert old status enum to the new one ──────────────────────
-- The two enums have identical values; we cast to text then to the new
-- enum so the underlying data is preserved.
ALTER TABLE "transfers" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "transfers"
  ALTER COLUMN "status" TYPE "transfer_status" USING "status"::text::"transfer_status";--> statement-breakpoint
ALTER TABLE "transfers" ALTER COLUMN "status" SET DEFAULT 'PENDING';--> statement-breakpoint

-- ── 4. Drop the old shape ──────────────────────────────────────────
-- transactions had no rows after the DELETE above; the empty table
-- accepts SET NOT NULL on the new columns immediately. Application
-- code (transactions.service.ts today; transfer.service.ts in Phase 1
-- Task 4) is the single write site and must always populate them.
ALTER TABLE "transfers" DROP COLUMN "type";--> statement-breakpoint
ALTER TABLE "transfers" DROP COLUMN "token";--> statement-breakpoint
ALTER TABLE "transfers" DROP COLUMN "amount";--> statement-breakpoint

ALTER TABLE "transfers" ALTER COLUMN "direction" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transfers" ALTER COLUMN "mint" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transfers" ALTER COLUMN "amount_raw" SET NOT NULL;--> statement-breakpoint

DROP TYPE "public"."tx_type";--> statement-breakpoint
DROP TYPE "public"."tx_status";
