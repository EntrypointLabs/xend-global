-- A code sent to an address that already has an Account opens a limited
-- session, and a code minted for that must never be spendable as a sign-up or
-- rotation proof, so it gets its own purpose.
ALTER TYPE "recovery_challenge_purpose" ADD VALUE IF NOT EXISTS 'entry_session';
--> statement-breakpoint
-- The limited session itself. Presented on every request until it expires or
-- is revoked, unlike a sign-up token, which is spent once. Hash only: the raw
-- token crosses the boundary once and is never stored.
CREATE TABLE IF NOT EXISTS "entry_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "entry_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "entry_sessions" ADD CONSTRAINT "entry_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entry_sessions_user_idx" ON "entry_sessions" USING btree ("user_id");
