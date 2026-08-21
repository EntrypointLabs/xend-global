-- transfers.usd_value / usd_priced_at — what a transfer was worth when it
-- happened, frozen.
--
-- Five SOL received while SOL was $100 is $500 forever, because $500 is what
-- changed hands. Pricing the row again on every read would rewrite a
-- Consumer's history every time the market moved, so the value is stamped once
-- at first index and never recomputed.
--
-- usd_priced_at records when the price behind the value was observed, because
-- it is not always confirmed_at: a transfer first indexed by a backfill is
-- stamped at backfill time, that being the closest rate available rather than
-- the true historical one. A wide gap between the two columns is the signal
-- that the figure is an approximation.
--
-- Both nullable: a mint nothing can price has no value to record, and null is
-- the honest answer rather than zero.
--
-- Hand-authored (drizzle-kit generate is unusable in this repo; see 0008).
-- Defensive (IF NOT EXISTS) so a re-run is a no-op.

ALTER TABLE "transfers"
  ADD COLUMN IF NOT EXISTS "usd_value" numeric(24, 6);

ALTER TABLE "transfers"
  ADD COLUMN IF NOT EXISTS "usd_priced_at" timestamp;
