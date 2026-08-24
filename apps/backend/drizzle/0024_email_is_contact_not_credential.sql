-- The passkey is the credential now. A Consumer exists from the moment they
-- create one, and the email is asked for afterwards, so it cannot be required
-- at the point the row is written.
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;
