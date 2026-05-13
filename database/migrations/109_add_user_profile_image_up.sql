-- User profile avatar image upload.
--
-- Mirrors the group avatar pattern from migration 108: inline BYTEA on
-- a per-browser_id row, plus a stored MIME type and an `image_updated_at`
-- cache-buster. The image is the cropped square JPEG/PNG that the FE
-- exports from `ImageCropModal` and that replaces the user's initials
-- circle wherever the current user's name is rendered.
--
-- Keyed by `browser_id` (the per-browser uuid issued by
-- `BrowserIdMiddleware`) so a user's image survives across sessions
-- without an account model. One device = one profile. Past content
-- created before browser_id capture started won't have a matching
-- browser_id so it continues to render initials — that's the
-- intentional "new participations only" semantics (the user does not
-- want to backfill).
--
-- Trust model: anyone holding a browser_id may set/clear the image
-- for that browser_id, same as the legacy "anyone with the URL can
-- change the group's image" stance for groups. Since the FE only
-- sends the request from the browser whose id is being modified, and
-- the middleware echoes browser_id from the request header, this
-- effectively gates writes by physical possession of the browser
-- (or its localStorage).

BEGIN;

CREATE TABLE IF NOT EXISTS user_profiles (
  browser_id UUID PRIMARY KEY,
  image_data BYTEA,
  image_mime_type TEXT,
  image_updated_at TIMESTAMPTZ
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access on user_profiles" ON user_profiles;
CREATE POLICY "Allow public read access on user_profiles" ON user_profiles
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public insert access on user_profiles" ON user_profiles;
CREATE POLICY "Allow public insert access on user_profiles" ON user_profiles
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public update access on user_profiles" ON user_profiles;
CREATE POLICY "Allow public update access on user_profiles" ON user_profiles
  FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Allow public delete access on user_profiles" ON user_profiles;
CREATE POLICY "Allow public delete access on user_profiles" ON user_profiles
  FOR DELETE USING (true);

COMMIT;
