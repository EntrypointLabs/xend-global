-- recovery_signers — the Account's recovery keys (S3 in ADR 0025, plus any the
-- Consumer adds later). One row per signer.
--
-- An email signer's secret is generated at signup and held here sealed; using it
-- requires proving control of channel_value. An external_wallet signer is the
-- Consumer's own key, so sealed_key is null and only the pubkey is stored.
--
-- The "an Account keeps at least one recovery signer" rule is deliberately NOT a
-- database constraint. It is about intent rather than referential integrity, and
-- expressing it in SQL would mean a trigger that fires on the wrong side of the
-- on-chain settings change. RecoveryService owns it.
--
-- Hand-authored (drizzle-kit generate is unusable in this repo; see 0008).
-- Defensive (IF NOT EXISTS) so a re-run is a no-op.

DO $$ BEGIN
  CREATE TYPE "recovery_channel" AS ENUM ('email', 'external_wallet');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "recovery_signers" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id"),
  "address" text NOT NULL UNIQUE,
  "channel" "recovery_channel" NOT NULL,
  "channel_value" text NOT NULL,
  "sealed_key" text,
  "sealed_key_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- One signer per (Account, channel, value): re-adding the same email or wallet
-- is a no-op the service rejects rather than a second row.
CREATE UNIQUE INDEX IF NOT EXISTS "recovery_signers_user_channel_idx"
  ON "recovery_signers" USING btree ("user_id", "channel", "channel_value");

CREATE INDEX IF NOT EXISTS "recovery_signers_user_idx"
  ON "recovery_signers" USING btree ("user_id");
