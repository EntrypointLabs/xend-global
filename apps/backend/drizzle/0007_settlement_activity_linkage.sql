-- Adds Activity linkage for Pay settlements: transfers.kind (a transfer_kind
-- enum discriminant, default 'transfer' so existing inserts are unaffected)
-- and a nullable transfers.payment_id FK to payments. A confirmed settlement
-- transfer is correlated to its payment by signature at confirmation time.
--
-- Hand-authored (drizzle-kit generate is unusable in this repo: bigint
-- default on tailer_state, and it prompts on the new enum). Additive only;
-- no existing transfer column is touched. Statements are idempotent.

DO $$ BEGIN
 CREATE TYPE "public"."transfer_kind" AS ENUM('transfer', 'payment');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN IF NOT EXISTS "kind" "public"."transfer_kind" DEFAULT 'transfer' NOT NULL;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN IF NOT EXISTS "payment_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transfers" ADD CONSTRAINT "transfers_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
