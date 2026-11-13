ALTER TABLE "fiat_bank_notifications"
  ADD COLUMN "query_attempts" integer NOT NULL DEFAULT 0 CHECK ("query_attempts" >= 0),
  ADD COLUMN "query_claim" uuid,
  ADD COLUMN "next_query_at" timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN "queried_at" timestamptz,
  ADD COLUMN "query_result" jsonb,
  ADD COLUMN "query_error" text;
--> statement-breakpoint
CREATE INDEX "fiat_bank_notifications_due" ON "fiat_bank_notifications" ("provider", "environment", "merchant_id", "next_query_at") WHERE "status" = 'received';
