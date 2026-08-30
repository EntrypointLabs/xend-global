-- A Payment too large for one signature is handed to the Consumer's phone.
--
-- Checkout cannot reach the approval signer, so it refuses and leaves the
-- intent payable. Without a mark, the app has no way to find the Payment
-- somebody is standing at a checkout waiting to finish: the consumer is only
-- recorded when an intent is authorized, and this one never got that far.
ALTER TABLE "payment_intents"
  ADD COLUMN IF NOT EXISTS "approval_deferred_at" timestamp;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_intents_deferred_idx"
  ON "payment_intents" ("consumer_id", "approval_deferred_at")
  WHERE "status" = 'created' AND "approval_deferred_at" IS NOT NULL;
