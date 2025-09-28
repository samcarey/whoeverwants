-- Rollback: Create polls table
-- Migration: 001_create_polls_table
-- Description: Removes the polls table and related objects

-- Drop the table (this will also drop the trigger)
DROP TABLE IF EXISTS polls;

-- Drop the trigger function (only if no other tables use it)
-- Note: Be careful with this in production - other tables might use this function
DROP FUNCTION IF EXISTS update_updated_at_column();