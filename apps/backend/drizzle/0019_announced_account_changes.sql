-- The staged-change watcher runs on a timer; without this it would announce the
-- same change on every tick.
CREATE TABLE IF NOT EXISTS "announced_account_changes" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id"),
  "settings_address" text NOT NULL,
  "transaction_index" bigint NOT NULL,
  "announced_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "announced_account_changes_idx" ON "announced_account_changes" ("settings_address","transaction_index");
