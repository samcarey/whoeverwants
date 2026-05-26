-- Move profile photos from per-browser to per-account (user_id) ownership.
--
-- Migration 109 keyed `user_profiles` by `browser_id` so the photo lived on
-- one device with no account model. The photo is now account data, like the
-- display name (`users.display_name`): it follows the user across devices and
-- disappears on sign-out. Uploading a photo requires an account (the FE gates
-- it behind the same account-setup modal as creating a group / voting); the
-- upload endpoint resolves-or-mints the caller's account exactly like
-- `POST /api/polls` does for the creator.
--
-- Existing rows are backfilled to the account linked to the uploading browser
-- (`user_browsers`). When several of an account's browsers each had a photo we
-- keep the newest. Anonymous photos whose browser has no account can't exist
-- in the account-keyed model and are dropped (rare; affected users re-upload
-- after the account gate — consistent with the "new participations only"
-- stance migration 109 already took for pre-capture content).

BEGIN;

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- A photo's owner is the account linked to the browser that uploaded it.
UPDATE user_profiles p
   SET user_id = ub.user_id
  FROM user_browsers ub
 WHERE ub.browser_id = p.browser_id
   AND p.user_id IS NULL;

-- Dedup: if an account had photos on multiple linked browsers, keep the one
-- with the newest image_updated_at (ctid breaks exact ties).
DELETE FROM user_profiles a
 USING user_profiles b
 WHERE a.user_id IS NOT NULL
   AND a.user_id = b.user_id
   AND (
        COALESCE(a.image_updated_at, '-infinity'::timestamptz)
          < COALESCE(b.image_updated_at, '-infinity'::timestamptz)
     OR (a.image_updated_at IS NOT DISTINCT FROM b.image_updated_at
         AND a.ctid < b.ctid)
   );

-- Anonymous photos with no resolvable account can't be account-keyed; drop them.
DELETE FROM user_profiles WHERE user_id IS NULL;

ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_pkey;
ALTER TABLE user_profiles DROP COLUMN browser_id;
ALTER TABLE user_profiles ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE user_profiles ADD PRIMARY KEY (user_id);

COMMIT;
