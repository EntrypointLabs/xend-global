ALTER TABLE "api_keys" ADD COLUMN "execution_cluster" text;
--> statement-breakpoint
ALTER TABLE "payment_intents" ADD COLUMN "execution_cluster" text;
