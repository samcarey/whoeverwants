-- Migration 127: per-question custom category emoji.
-- When a question's category is custom (user-typed, not a built-in type),
-- the creator can pick an emoji to represent it. Stored here so the chosen
-- glyph follows the question everywhere the category icon is rendered
-- (group cards, poll detail, push notifications) instead of falling back to
-- the generic ballot-box symbol. NULL for built-in categories and for custom
-- categories created before this migration (they keep the type-symbol
-- fallback).
ALTER TABLE questions ADD COLUMN IF NOT EXISTS category_icon TEXT;
