-- The proof that ties the address a Consumer just verified to the passkey
-- they create next. Sign-up is two unauthenticated calls with a ceremony in
-- between, and without this nothing binds the Privy user that arrives at
-- exchange to the users row the code was proved against. Hash only: the raw
-- token crosses the boundary once and is never stored.
CREATE TABLE IF NOT EXISTS "signup_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "signup_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "signup_tokens" ADD CONSTRAINT "signup_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signup_tokens_user_idx" ON "signup_tokens" USING btree ("user_id");
