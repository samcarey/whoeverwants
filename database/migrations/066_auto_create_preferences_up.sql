-- Add columns for auto-creating a preferences (ranked_choice) poll when a nomination poll closes.
-- auto_create_preferences: if true, a placeholder ranked_choice poll is reserved at creation time
--   and activated with nominations when the parent nomination poll closes.
-- auto_preferences_deadline_minutes: how many minutes the auto-created preferences poll stays open.

ALTER TABLE polls ADD COLUMN auto_create_preferences BOOLEAN DEFAULT false;
ALTER TABLE polls ADD COLUMN auto_preferences_deadline_minutes INT;
