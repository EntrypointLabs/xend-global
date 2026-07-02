-- Adds:
--   1. tailer_state — per-wallet bookmark for the boot-time
--      getSignaturesForAddress replay. One row per active wallet;
--      updated by the tailer hot path AND by the boot replay.
--   2. transfers_pending_idx — partial index the reconciliation poll
--      uses to find outstanding PENDING rows cheaply. The partial form
--      keeps the index tiny (only PENDING rows ever land in it;
--      CONFIRMED and FAILED rows fall out on update).
--
-- This DDL is authoritative; the schema.ts companion mirrors it exactly.

CREATE TABLE "tailer_state" (
  "wallet_address" text PRIMARY KEY NOT NULL,
  "last_indexed_slot" bigint NOT NULL DEFAULT 0,
  "updated_at" timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX "transfers_pending_idx"
  ON "transfers" ("submitted_at")
  WHERE "status" = 'PENDING';
