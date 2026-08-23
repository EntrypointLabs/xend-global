-- Activity is the Consumer's record of what happened to their account, and
-- money is only part of that. A separate table because a transfer row is shaped
-- around money and these events have none of that shape.
DO $$ BEGIN
  CREATE TYPE "account_event_kind" AS ENUM ('recovery_key_added', 'recovery_key_removed', 'wallet_renamed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account_events" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id"),
  "kind" "account_event_kind" NOT NULL,
  "subject" text,
  "previous_subject" text,
  "dedupe_key" text NOT NULL,
  "occurred_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Recording is driven by a reconciler that runs again on every poll, so the
-- guard against duplicates has to be in the database, not the caller.
CREATE UNIQUE INDEX IF NOT EXISTS "account_events_dedupe_idx" ON "account_events" ("dedupe_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_events_user_time_idx" ON "account_events" ("user_id","occurred_at");
