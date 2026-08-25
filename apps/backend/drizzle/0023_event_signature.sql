-- Activity shows the transaction that landed a key change, so both the event
-- and the row driving it have to remember it.
ALTER TABLE "account_events" ADD COLUMN IF NOT EXISTS "signature" text;
--> statement-breakpoint
ALTER TABLE "recovery_signers" ADD COLUMN IF NOT EXISTS "change_signature" text;
