CREATE TABLE "merchant_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target" text,
	"metadata" jsonb,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "rotated_from_id" text;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "kyb_submitted_at" timestamp;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "kyb_review_note" text;--> statement-breakpoint
ALTER TABLE "merchant_audit_log" ADD CONSTRAINT "merchant_audit_log_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "merchant_audit_log_merchant_at_idx" ON "merchant_audit_log" USING btree ("merchant_id","at");