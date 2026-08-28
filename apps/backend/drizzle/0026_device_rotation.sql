-- A lost phone takes S2 with it, so recovery swaps the approval signer for a
-- new one. The incoming key is held beside the live one rather than replacing
-- it: the swap is not real until the settings change carrying it executes, and
-- that waits out the 24 hour time lock like every other settings change.
ALTER TABLE "squads_accounts" ADD COLUMN IF NOT EXISTS "pending_approval_signer" text;
--> statement-breakpoint
ALTER TABLE "squads_accounts" ADD COLUMN IF NOT EXISTS "pending_approval_sub_org_id" text;
--> statement-breakpoint
ALTER TABLE "squads_accounts" ADD COLUMN IF NOT EXISTS "pending_approval_change_index" text;
--> statement-breakpoint
ALTER TYPE "account_event_kind" ADD VALUE IF NOT EXISTS 'device_rotated';
