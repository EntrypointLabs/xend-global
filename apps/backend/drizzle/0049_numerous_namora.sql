CREATE INDEX "capacity_counters_expires_at_idx" ON "capacity_counters" USING btree ("expires_at");--> statement-breakpoint
-- Compatibility for environments that applied 0048 before its rolling-deploy
-- guard was added during review.
CREATE UNIQUE INDEX IF NOT EXISTS "payment_intents_merchant_legacy_idem_idx" ON "payment_intents" USING btree ("merchant_id","idempotency_key") WHERE "payment_intents"."execution_cluster" IS NULL AND "payment_intents"."idempotency_key" IS NOT NULL;
