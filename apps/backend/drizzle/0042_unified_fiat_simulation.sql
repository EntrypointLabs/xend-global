CREATE TABLE "fiat_unified_wallets" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"holdings" jsonb NOT NULL,
	"records" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fiat_unified_wallets" ADD CONSTRAINT "fiat_unified_wallets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;