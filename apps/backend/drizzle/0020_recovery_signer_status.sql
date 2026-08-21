-- A recovery signer is only real once the Settings change carrying it has
-- executed, and that waits out the time lock. Existing rows were put in the
-- signer set at Account creation, so 'active' is the right default for them.
DO $$ BEGIN
  CREATE TYPE "recovery_signer_status" AS ENUM ('pending_add', 'active', 'pending_remove');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "recovery_signers" ADD COLUMN IF NOT EXISTS "status" "recovery_signer_status" DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE "recovery_signers" ADD COLUMN IF NOT EXISTS "change_index" text;
