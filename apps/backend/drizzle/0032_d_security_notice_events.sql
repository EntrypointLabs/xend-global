-- Every security-relevant change is recorded as an account event and mailed
-- from that record, so the kinds that only ever produced a push, or nothing,
-- need a row of their own. A staged change is recorded the moment it is
-- staged, and its outcome separately, because the notice for each is a
-- different sentence at a different moment.
ALTER TYPE "account_event_kind" ADD VALUE IF NOT EXISTS 'recovery_key_rotated';
--> statement-breakpoint
ALTER TYPE "account_event_kind" ADD VALUE IF NOT EXISTS 'contact_email_changed';
--> statement-breakpoint
ALTER TYPE "account_event_kind" ADD VALUE IF NOT EXISTS 'settings_change_staged';
--> statement-breakpoint
ALTER TYPE "account_event_kind" ADD VALUE IF NOT EXISTS 'settings_change_executed';
--> statement-breakpoint
ALTER TYPE "account_event_kind" ADD VALUE IF NOT EXISTS 'settings_change_rejected';
--> statement-breakpoint
ALTER TYPE "account_event_kind" ADD VALUE IF NOT EXISTS 'passkey_enrolled';
--> statement-breakpoint
ALTER TYPE "account_event_kind" ADD VALUE IF NOT EXISTS 'spending_limit_changed';
