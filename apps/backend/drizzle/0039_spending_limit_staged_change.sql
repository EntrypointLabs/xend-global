-- Hand-authored, matching the repo convention. Defensive so a re-run is a no-op.
--
-- The Spending Limit change in flight. It used to live in the prepared
-- transaction cache under a 48 hour TTL, which forgot changes the chain could
-- still execute: a proposal sits unproposed or unapproved for as long as the
-- Consumer leaves it, and the 24 hour lock only starts once it is approved.
-- The index is the marker; a staged removal carries an index and no amount.
ALTER TABLE "squads_accounts" ADD COLUMN IF NOT EXISTS "pending_spending_limit_change_index" text;--> statement-breakpoint
ALTER TABLE "squads_accounts" ADD COLUMN IF NOT EXISTS "pending_spending_limit_amount" text;--> statement-breakpoint
ALTER TABLE "squads_accounts" ADD COLUMN IF NOT EXISTS "pending_spending_limit_policy_seed" bigint;--> statement-breakpoint
ALTER TABLE "squads_accounts" ADD COLUMN IF NOT EXISTS "pending_spending_limit_creating" boolean;--> statement-breakpoint
ALTER TABLE "squads_accounts" ADD COLUMN IF NOT EXISTS "pending_spending_limit_period" text;--> statement-breakpoint
ALTER TABLE "squads_accounts" ADD COLUMN IF NOT EXISTS "pending_spending_limit_previous" text;
