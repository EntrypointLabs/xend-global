-- A wallet may back more than one Consumer's recovery. Only within a single
-- Consumer must it be unique, so it cannot count twice toward one threshold.
ALTER TABLE "recovery_signers" DROP CONSTRAINT IF EXISTS "recovery_signers_address_key";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "recovery_signers_user_address_idx" ON "recovery_signers" ("user_id","address");
