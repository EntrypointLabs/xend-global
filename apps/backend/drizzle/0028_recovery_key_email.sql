-- A recovery key added later is proved the same way the first one is. An
-- address nobody has answered at is not a way back into an Account, it is a
-- second thing that looks like one.
ALTER TYPE "recovery_challenge_purpose" ADD VALUE IF NOT EXISTS 'recovery_key_email';
