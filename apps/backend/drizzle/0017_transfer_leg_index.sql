-- One signature can carry several transfers. Keyed on the signature alone,
-- every leg after the first overwrote the one before it.
ALTER TABLE "transfers" ADD COLUMN "leg_index" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "transfers" DROP CONSTRAINT IF EXISTS "transfers_signature_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "transfers_signature_leg_idx" ON "transfers" ("signature","mint","from_address","to_address","amount_raw","leg_index");
