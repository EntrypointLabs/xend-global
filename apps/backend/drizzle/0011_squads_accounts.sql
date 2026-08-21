-- squads_accounts — the Consumer's Squads smart account (ADR 0025). One row
-- per user.
--
-- Kept separate from smart_accounts, which describes the Privy embedded wallet.
-- Both exist at once: Privy stays the primary signer, and its wallet still
-- holds any pre-multisig balance until that is swept to the vault.
--
-- settings_seed is the column this table exists for. The program assigns the
-- seed from a global counter at creation, so an Account address cannot be
-- recomputed from its signer set. Rotating a signer does not change the
-- address, but losing the seed loses the ability to re-derive it.
--
-- vault_address is the Consumer's address everywhere: QR code, deposits,
-- balance reads. settings_address holds the signer set and never holds money,
-- so it must never be shown to a Consumer as an address.
--
-- Hand-authored (drizzle-kit generate is unusable in this repo; see 0008).
-- Defensive (IF NOT EXISTS) so a re-run is a no-op.

CREATE TABLE IF NOT EXISTS "squads_accounts" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL UNIQUE REFERENCES "users"("id"),
  "settings_seed" bigint NOT NULL,
  "settings_address" text NOT NULL UNIQUE,
  "vault_address" text NOT NULL UNIQUE,
  "primary_signer" text NOT NULL,
  "approval_signer" text NOT NULL,
  "approval_sub_org_id" text NOT NULL UNIQUE,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Balance and activity reads land on the vault, not the user id.
CREATE INDEX IF NOT EXISTS "squads_accounts_vault_idx"
  ON "squads_accounts" ("vault_address");
