-- The contact address moves by rotating the recovery signer it anchors, so the
-- replacement address is proved with a code of its own. A code proved to add a
-- second recovery key must not be spendable on moving the entry point.
ALTER TYPE "recovery_challenge_purpose" ADD VALUE IF NOT EXISTS 'contact_rotation';
--> statement-breakpoint
-- Support can decline to release the server-held recovery signer while a
-- compromise report is open. Refusing to sign costs a Consumer holding their
-- passkey and phone nothing, and takes an attacker holding the inbox from one
-- vote to none.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "recovery_release_frozen_at" timestamp;
