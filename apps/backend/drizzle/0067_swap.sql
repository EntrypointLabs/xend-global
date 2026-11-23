CREATE TABLE "swaps" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"signature" text NOT NULL,
	"input_mint" text NOT NULL,
	"output_mint" text NOT NULL,
	"amount_in_raw" text NOT NULL,
	"amount_out_raw" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "swaps_signature_unique" UNIQUE("signature")
);
--> statement-breakpoint
ALTER TABLE "squads_accounts" ADD COLUMN "pending_swap_access_change_index" text;--> statement-breakpoint
ALTER TABLE "swaps" ADD CONSTRAINT "swaps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;