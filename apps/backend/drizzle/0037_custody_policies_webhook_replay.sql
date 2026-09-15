-- Hand-authored, matching the repo convention (drizzle-kit generate diffs
-- against a snapshot this repo never regenerated). Every statement is
-- defensive so a re-run is a no-op.
--
-- The per-seal data key under KMS envelope custody. Null for env-key seals.
ALTER TABLE "recovery_signers" ADD COLUMN IF NOT EXISTS "wrapped_data_key" text;--> statement-breakpoint
-- Turnkey policy ids written onto the S2 sub-organization at enrolment.
ALTER TABLE "approval_signers" ADD COLUMN IF NOT EXISTS "policy_ids" jsonb;--> statement-breakpoint
-- Provider deliveries already acted on, so a replay is a no-op.
CREATE TABLE IF NOT EXISTS "inbound_webhook_events" (
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inbound_webhook_events_provider_event_idx" ON "inbound_webhook_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbound_webhook_events_received_idx" ON "inbound_webhook_events" USING btree ("received_at");
