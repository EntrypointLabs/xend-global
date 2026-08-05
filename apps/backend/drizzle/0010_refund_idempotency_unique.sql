-- Data-layer backstop against a double refund (money-safety). The general
-- IdempotencyService snapshots the response only AFTER produce() runs, so two
-- concurrent refund requests with the same Idempotency-Key could both reach
-- provider.reverse() before either reserved the key. This unique index makes the
-- refunds insert itself the serialization point: the retry loses on 23505 before
-- it can reverse funds again. NULL keys are distinct in Postgres, so keyless
-- refunds stay unconstrained.
--
-- Hand-authored (drizzle-kit generate is unusable in this repo; see 0008).
-- Defensive (IF NOT EXISTS) so a re-run is a no-op.

CREATE UNIQUE INDEX IF NOT EXISTS "refunds_merchant_idem_idx" ON "refunds" USING btree ("merchant_id","idempotency_key");
