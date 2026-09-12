CREATE TABLE "fiat_bank_transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"source_account_id" text NOT NULL,
	"destination_account_id" text NOT NULL,
	"idempotency_key" text,
	"record" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fiat_bank_transfers" ADD CONSTRAINT "fiat_bank_transfers_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiat_bank_transfers" ADD CONSTRAINT "fiat_bank_transfers_source_account_id_fiat_bank_accounts_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."fiat_bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiat_bank_transfers" ADD CONSTRAINT "fiat_bank_transfers_destination_account_id_fiat_bank_accounts_id_fk" FOREIGN KEY ("destination_account_id") REFERENCES "public"."fiat_bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fiat_bank_transfers_owner_key" ON "fiat_bank_transfers" USING btree ("owner_id","idempotency_key");