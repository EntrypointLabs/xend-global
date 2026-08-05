-- Soft-delete marker for account closure (Delete Account). The users row,
-- its smart_accounts, and its transfers all stay for the financial-
-- recordkeeping retention the privacy policy commits to; JwtStrategy
-- rejects any token once this is set.
--
-- Hand-authored (drizzle-kit generate is unusable in this repo; see
-- 0009_settlement_offramps for the same issue).
-- Defensive (IF NOT EXISTS) so a re-run is a no-op.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
