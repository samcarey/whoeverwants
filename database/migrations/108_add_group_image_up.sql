-- Group avatar image upload.
--
-- The home list, group page header, and /info hero all currently render
-- a participant-initials avatar (RespondentCircles). This migration adds
-- optional image storage so a group can upload a custom circular avatar
-- that replaces the initials graphic.
--
-- Storage: inline BYTEA on the `groups` row. The FE crops to a square
-- before upload and the server stores the resulting JPEG/PNG bytes
-- verbatim (no server-side resize today; the FE caps the export at
-- ~512px). Inline storage keeps backups simple — pg_dump covers it
-- automatically — and avoids a second storage surface.
--
-- `image_updated_at` doubles as the cache-buster: the FE constructs
-- `/api/groups/by-route-id/<id>/image?v=<isoTimestamp>` so a freshly
-- updated image invalidates browser + CDN caches without changing the
-- group's identity.

BEGIN;

ALTER TABLE groups
  ADD COLUMN image_data BYTEA,
  ADD COLUMN image_mime_type TEXT,
  ADD COLUMN image_updated_at TIMESTAMPTZ;

COMMIT;
