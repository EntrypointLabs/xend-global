CREATE TABLE "fiat_verifications" (
	"user_id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"external_user_id" text NOT NULL,
	"customer_id" text,
	"session_id" text,
	"status" text NOT NULL,
	"tier" integer,
	"decline_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fiat_verifications" ADD CONSTRAINT "fiat_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fiat_verification_external_unique" ON "fiat_verifications" USING btree ("provider","external_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fiat_verification_customer_unique" ON "fiat_verifications" USING btree ("provider","customer_id");--> statement-breakpoint
CREATE INDEX "fiat_order_provider_ref_idx" ON "fiat_orders" USING btree ("provider_reference");