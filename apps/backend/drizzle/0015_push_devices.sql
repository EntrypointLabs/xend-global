-- push_devices — where a Consumer's notifications go, and whether they want them.
--
-- Keyed by the device token rather than by user: one Consumer can hold several
-- devices and each answers for itself. `enabled` lives on the row for the same
-- reason, so silencing a phone does not silence a tablet the same person uses.
--
-- `enabled` records what the Consumer asked us for, which is not the same as
-- the OS permission. A revoked permission stops delivery whatever this says;
-- keeping our own answer means re-granting the permission does not silently
-- opt them back in.
--
-- Hand-authored (drizzle-kit generate is unusable in this repo; see 0008).
-- Defensive (IF NOT EXISTS) so a re-run is a no-op.

CREATE TABLE IF NOT EXISTS "push_devices" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "token" text NOT NULL,
  "platform" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "push_devices_token_key" UNIQUE ("token")
);

DO $$ BEGIN
  ALTER TABLE "push_devices"
    ADD CONSTRAINT "push_devices_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "push_devices_user_idx" ON "push_devices" ("user_id");
