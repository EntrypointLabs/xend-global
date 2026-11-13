DROP INDEX "idempotency_keys_merchant_key_idx";--> statement-breakpoint
DROP INDEX "payment_intents_merchant_idem_idx";--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "execution_cluster" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
UPDATE "idempotency_keys" AS "ik"
SET "execution_cluster" = "pi"."execution_cluster"
FROM "payment_intents" AS "pi"
WHERE "pi"."merchant_id" = "ik"."merchant_id"
  AND "pi"."idempotency_key" = "ik"."idempotency_key"
  AND "pi"."execution_cluster" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_merchant_key_idx" ON "idempotency_keys" USING btree ("merchant_id","execution_cluster","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_intents_merchant_idem_idx" ON "payment_intents" USING btree ("merchant_id","execution_cluster","idempotency_key");--> statement-breakpoint
-- Old application instances leave execution_cluster null during a rolling
-- deploy. PostgreSQL considers nulls distinct in the index above, so keep the
-- legacy writer domain unique until every old instance has stopped.
CREATE UNIQUE INDEX "payment_intents_merchant_legacy_idem_idx" ON "payment_intents" USING btree ("merchant_id","idempotency_key") WHERE "execution_cluster" IS NULL AND "idempotency_key" IS NOT NULL;
