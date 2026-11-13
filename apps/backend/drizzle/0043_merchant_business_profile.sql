ALTER TABLE merchants ADD COLUMN business_profile jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE merchants ADD COLUMN profile_version integer NOT NULL DEFAULT 0;
