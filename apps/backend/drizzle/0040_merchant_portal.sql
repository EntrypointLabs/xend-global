ALTER TABLE merchants ADD COLUMN owner_provider_id text UNIQUE;
ALTER TABLE merchants ADD COLUMN receiving_wallet text;
ALTER TABLE merchants ADD COLUMN settlement_terms_accepted_at timestamp;
