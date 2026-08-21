-- approval_signers — the Turnkey sub-organization backing S2, recorded as soon
-- as it exists rather than once the Account completes.
--
-- Enrolment creates the sub-organization first and writes squads_accounts
-- last. Anything failing in between (an unfunded settlement authority, a lost
-- settings-seed race) leaves a real sub-organization at Turnkey that no row
-- points at. The retry then cannot find it and creates another, stranding the
-- first with the Consumer's hardware key already registered on it.
--
-- The unique index is on (user_id, hardware_public_key), not user_id alone.
-- The sub-org's authenticator IS that hardware key, so a Consumer enrolling
-- from a replacement device must get a new sub-organization; handing back the
-- old one would give them an S2 their device holds no key for.
--
-- Hand-authored (drizzle-kit generate is unusable in this repo; see 0008).
-- Defensive (IF NOT EXISTS) so a re-run is a no-op.

CREATE TABLE IF NOT EXISTS "approval_signers" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "sub_organization_id" text NOT NULL,
  "address" text NOT NULL,
  "hardware_public_key" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "approval_signers_sub_organization_id_key" UNIQUE ("sub_organization_id"),
  CONSTRAINT "approval_signers_address_key" UNIQUE ("address")
);

DO $$ BEGIN
  ALTER TABLE "approval_signers"
    ADD CONSTRAINT "approval_signers_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "approval_signers_user_device_idx"
  ON "approval_signers" ("user_id", "hardware_public_key");
