ALTER TYPE "recovery_challenge_purpose" ADD VALUE 'primary_rotation';--> statement-breakpoint
ALTER TABLE "squads_accounts" ADD COLUMN "pending_primary_signer" text;--> statement-breakpoint
ALTER TABLE "squads_accounts" ADD COLUMN "pending_primary_provider_id" text;--> statement-breakpoint
ALTER TABLE "squads_accounts" ADD COLUMN "pending_primary_change_index" text;
