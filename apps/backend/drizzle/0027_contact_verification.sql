-- The address S3 is anchored on has to be one the Consumer has proved they
-- hold. Anchoring recovery on an unverified string means a typo produces an
-- Account whose only way back points at an inbox nobody reads, and the
-- Consumer finds out when they have already lost the phone.
ALTER TYPE "recovery_challenge_purpose" ADD VALUE IF NOT EXISTS 'contact_verification';
--> statement-breakpoint
-- Which address the code went to. For a rotation that is the address on file;
-- for a contact check it is the one being claimed, which is not on the user
-- row yet and must not be written there until this row says it was proved.
ALTER TABLE "recovery_challenges" ADD COLUMN IF NOT EXISTS "target" text;
