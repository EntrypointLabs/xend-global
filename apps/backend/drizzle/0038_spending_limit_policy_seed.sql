-- Hand-authored, matching the repo convention. Defensive so a re-run is a no-op.
--
-- The seed of the policy carrying this Account's Spending Limit. Null means
-- the seed provisioning wrote, which is what every Account created so far
-- carries. Set only when a limit is created again after one was removed: the
-- program assigns policy seeds in order and never reuses one, so the new
-- policy lands past the original seed and nothing could find it otherwise.
ALTER TABLE "squads_accounts" ADD COLUMN IF NOT EXISTS "spending_limit_policy_seed" bigint;
