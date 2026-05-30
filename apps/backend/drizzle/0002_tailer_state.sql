-- 0002_tailer_state.sql — Phase 2: RPC tailer state + pending-poll index.
--
-- Adds:
--   1. tailer_state — per-wallet bookmark for the boot-time
--      `getSignaturesForAddress(wallet, { until: last_indexed_slot })`
--      replay. Keyed on wallet_address (TEXT primary key, mirrors the
--      shape of smart_accounts.wallet_address). One row per active
--      wallet; updated by the tailer hot path AND by the boot replay.
--   2. transfers_pending_idx — partial index that the 30-second
--      reconciliation poll uses to find outstanding PENDING rows
--      cheaply. Predicate matches the WHERE clause in
--      ReconcilerService.tick(): `status='PENDING' AND submitted_at <
--      NOW() - INTERVAL '30 seconds'`. The partial form keeps the
--      index tiny (only PENDING rows ever land in it; CONFIRMED and
--      FAILED rows fall out on update).
--
-- DDL is authoritative — drizzle-kit generate requires interactive
-- input for enum/value prompts which the team-plan workflow cannot
-- supply; the schema.ts companion mirrors this file exactly.
--
-- Spec: docs/specs/migration-already-built-features.md §5.6.
-- Plan: .claude/plans/xend-grid-migration/phases/phase-2-rpc-tailer/PLAN.md

CREATE TABLE "tailer_state" (
  "wallet_address" text PRIMARY KEY NOT NULL,
  "last_indexed_slot" bigint NOT NULL DEFAULT 0,
  "updated_at" timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX "transfers_pending_idx"
  ON "transfers" ("submitted_at")
  WHERE "status" = 'PENDING';
