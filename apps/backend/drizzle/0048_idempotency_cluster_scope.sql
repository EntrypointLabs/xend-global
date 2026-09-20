DROP INDEX "idempotency_keys_merchant_key_idx";--> statement-breakpoint
DROP INDEX "payment_intents_merchant_idem_idx";--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "execution_cluster" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_merchant_key_idx" ON "idempotency_keys" USING btree ("merchant_id","execution_cluster","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_intents_merchant_idem_idx" ON "payment_intents" USING btree ("merchant_id","execution_cluster","idempotency_key");
