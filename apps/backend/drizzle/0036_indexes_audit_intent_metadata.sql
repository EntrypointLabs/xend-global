-- Hand-authored, matching the repo convention (drizzle-kit generate diffs
-- against a snapshot this repo never regenerated). Every statement is
-- defensive so a re-run is a no-op.
--
-- Hot-path indexes that were missing: the Activity read by account, the
-- webhook retry sweep, the settlement sweep by attempt status, and the
-- off-ramp reconciler by status.
CREATE INDEX IF NOT EXISTS "transfers_smart_account_idx" ON "transfers" USING btree ("smart_account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_retry_idx" ON "webhook_deliveries" USING btree ("status","next_retry_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_attempts_status_idx" ON "payment_attempts" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "settlement_offramps_status_idx" ON "settlement_offramps" USING btree ("status");--> statement-breakpoint
-- Merchant metadata echoed on the intent, and the origin that opened Checkout.
ALTER TABLE "payment_intents" ADD COLUMN IF NOT EXISTS "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD COLUMN IF NOT EXISTS "opener_origin" text;--> statement-breakpoint
-- A rotated-out webhook secret stops signing after this.
ALTER TABLE "webhook_endpoints" ADD COLUMN IF NOT EXISTS "secondary_expires_at" timestamp;--> statement-breakpoint
-- When a device's approval signer was retired by a rotation.
ALTER TABLE "approval_signers" ADD COLUMN IF NOT EXISTS "revoked_at" timestamp with time zone;--> statement-breakpoint
-- Operator writes from the internal console.
CREATE TABLE IF NOT EXISTS "admin_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target" text,
	"at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_log_at_idx" ON "admin_audit_log" USING btree ("at");
