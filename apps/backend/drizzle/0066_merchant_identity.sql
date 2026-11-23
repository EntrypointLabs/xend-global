CREATE TYPE "public"."merchant_category" AS ENUM('shopping', 'food_drink', 'groceries', 'transport', 'travel', 'entertainment', 'health', 'services', 'bills', 'other');--> statement-breakpoint
CREATE TABLE "merchant_logos" (
	"merchant_id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"content_type" text,
	"data" "bytea",
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "category" "merchant_category" DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "merchant_logos" ADD CONSTRAINT "merchant_logos_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;