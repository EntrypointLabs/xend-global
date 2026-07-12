-- Adds:
--   passkey_credentials — mirrored WebAuthn credential metadata captured
--   at enrollment and on login. Vendor hedge: if the wallet vendor is
--   unavailable or swapped, the credential inventory survives.
--   credential_id is UNIQUE (one row per credential); public_key is
--   nullable because the server-side vendor SDK omits it and the client
--   backfills it at enrollment.
--
-- Hand-authored to mirror schema.ts, following 0001/0002: drizzle-kit
-- generate cannot serialize this schema (bigint().default(0n) on
-- tailer_state throws "Do not know how to serialize a BigInt"). This DDL
-- is authoritative; the schema.ts companion mirrors it exactly.

CREATE TABLE "passkey_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "passkey_credentials_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
ALTER TABLE "passkey_credentials" ADD CONSTRAINT "passkey_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "passkey_credentials_user_idx" ON "passkey_credentials" USING btree ("user_id");
