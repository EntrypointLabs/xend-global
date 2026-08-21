-- Move the notification preference from the device to the person.
--
-- It lived on push_devices, which produced two bugs. Toggling it off with no
-- device registered updated zero rows and the answer silently reverted to on.
-- And a re-registered token kept the previous owner's value, so the next
-- account on a shared or reinstalled device inherited an opt-out it never made.
--
-- The setting is one switch in the app, so it belongs to the user. push_devices
-- goes back to being only an address list.
--
-- Hand-authored (drizzle-kit generate is unusable in this repo; see 0008).
-- Defensive so a re-run is a no-op.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "notifications_enabled" boolean DEFAULT true NOT NULL;

ALTER TABLE "push_devices"
  DROP COLUMN IF EXISTS "enabled";
