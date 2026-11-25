CREATE TABLE "earn_operations" (
	"signature" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"action" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"vault" text NOT NULL,
	"wire" text,
	"message_hash" text NOT NULL,
	"quote" jsonb NOT NULL,
	"block_height" integer NOT NULL,
	"cash_delta_raw" text,
	"share_delta_raw" text,
	"confirmed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "earn_operations_message_hash_unique" UNIQUE("message_hash")
);
--> statement-breakpoint
ALTER TABLE "earn_operations" ADD CONSTRAINT "earn_operations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "earn_operations_user_idx" ON "earn_operations" USING btree ("user_id");