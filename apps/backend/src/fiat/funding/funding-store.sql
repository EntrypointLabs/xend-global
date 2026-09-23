-- Explicit initializer for isolated integration tests only. Production migration
-- and reconciled ledger ingestion must be reviewed before wiring this store live.
-- Replace __SCHEMA__ with a validated, quoted schema identifier.
CREATE TABLE __SCHEMA__.funding_holdings (
  owner_id text PRIMARY KEY,
  ngn_settled numeric(30, 0) NOT NULL CHECK (ngn_settled >= 0),
  ngn_reserved numeric(30, 0) NOT NULL DEFAULT 0 CHECK (ngn_reserved >= 0 AND ngn_reserved <= ngn_settled),
  usdc_settled numeric(30, 0) NOT NULL CHECK (usdc_settled >= 0),
  usdc_reserved numeric(30, 0) NOT NULL DEFAULT 0 CHECK (usdc_reserved >= 0 AND usdc_reserved <= usdc_settled),
  reconciliation_reference text NOT NULL CHECK (length(reconciliation_reference) > 0),
  reconciled_at timestamptz NOT NULL
);

CREATE TABLE __SCHEMA__.funding_intents (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL REFERENCES __SCHEMA__.funding_holdings(owner_id),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  plan jsonb NOT NULL,
  state jsonb NOT NULL,
  execution_binding jsonb NOT NULL,
  conversion_provider text,
  conversion_quote_reference text,
  payout_action_reference text NOT NULL UNIQUE,
  conversion_action_reference text UNIQUE,
  holdings_reconciliation_reference text NOT NULL,
  holdings_reconciled_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(owner_id, idempotency_key),
  UNIQUE(conversion_provider, conversion_quote_reference)
);

CREATE TABLE __SCHEMA__.funding_journal (
  sequence bigserial PRIMARY KEY,
  intent_id uuid NOT NULL REFERENCES __SCHEMA__.funding_intents(id),
  event_id text NOT NULL,
  event jsonb NOT NULL,
  state jsonb NOT NULL,
  deltas jsonb NOT NULL,
  evidence_kind text,
  evidence_reference text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(intent_id, event_id),
  UNIQUE(evidence_kind, evidence_reference)
);
CREATE FUNCTION __SCHEMA__.reject_funding_journal_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'FUNDING_JOURNAL_IMMUTABLE'; END $$;
CREATE TRIGGER funding_journal_immutable BEFORE UPDATE OR DELETE
ON __SCHEMA__.funding_journal FOR EACH ROW
EXECUTE FUNCTION __SCHEMA__.reject_funding_journal_mutation();
