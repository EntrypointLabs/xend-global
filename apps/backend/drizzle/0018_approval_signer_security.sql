-- Enrolment is resumable, and a retry reusing an already attested key has no
-- fresh attestation to read the hardware level out of.
ALTER TABLE "approval_signers" ADD COLUMN IF NOT EXISTS "security" text;
