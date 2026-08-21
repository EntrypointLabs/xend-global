-- transfers.decimals — the mint's decimals as the chain reported them.
--
-- Without it a row cannot state its own amount. The client was reading
-- decimals from the Consumer's CURRENT holdings, which works right up until
-- they send a token away: the lookup misses, a six-decimal default takes over,
-- and five SOL renders as five thousand.
--
-- Nullable: rows indexed before this column existed have no answer, and the
-- client falls back to what it can infer rather than being handed a guess
-- dressed as fact.
--
-- Hand-authored (drizzle-kit generate is unusable in this repo; see 0008).
-- Defensive (IF NOT EXISTS) so a re-run is a no-op.

ALTER TABLE "transfers"
  ADD COLUMN IF NOT EXISTS "decimals" integer;
