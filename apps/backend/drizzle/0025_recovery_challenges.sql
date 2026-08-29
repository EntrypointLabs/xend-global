-- Proof that somebody holds the Consumer's inbox, which is the second factor
-- on the only flow that opens S3. The code is stored the way a password is,
-- and the attempt cap rather than the hash is what makes six digits safe.
DO $$ BEGIN
  CREATE TYPE "recovery_challenge_purpose" AS ENUM ('device_rotation');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recovery_challenges" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id"),
  "purpose" "recovery_challenge_purpose" NOT NULL,
  "code_hash" text NOT NULL,
  "salt" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "verified_at" timestamp,
  "consumed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recovery_challenges_user_idx" ON "recovery_challenges" ("user_id", "created_at");
