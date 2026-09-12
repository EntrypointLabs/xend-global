CREATE TABLE "fiat_bank_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"provider" text NOT NULL,
	"environment" text NOT NULL,
	"status" text NOT NULL,
	"account_reference" text NOT NULL,
	"account" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fiat_bank_accounts" ADD CONSTRAINT "fiat_bank_accounts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fiat_bank_accounts_owner_provider_env_key" ON "fiat_bank_accounts" USING btree ("owner_id","provider","environment");--> statement-breakpoint
CREATE UNIQUE INDEX "fiat_bank_accounts_provider_reference_key" ON "fiat_bank_accounts" USING btree ("provider","environment","account_reference");