# Database Migrations

This directory contains SQL migration files for the database schema.

## Structure

- `migrations/` - Contains SQL migration files
- `*_up.sql` - Files to apply changes (create tables, add columns, etc.)
- `*_down.sql` - Files to rollback changes (drop tables, remove columns, etc.)

## Migration Files

### 001_create_polls_table
- **Up**: Creates the `polls` table with basic structure
- **Down**: Drops the `polls` table and related functions

## How to Apply Migrations

### Via Supabase Dashboard
1. Go to your Supabase project dashboard
2. Navigate to the SQL Editor
3. Copy and paste the contents of the `*_up.sql` file
4. Run the SQL

### Via Supabase CLI (Alternative)
1. Install Supabase CLI: `npm install -g supabase`
2. Login: `supabase login`
3. Link project: `supabase link --project-ref your-project-ref`
4. Apply migration: `supabase db push`

## Rollback Instructions

To rollback a migration:
1. Go to your Supabase project dashboard
2. Navigate to the SQL Editor  
3. Copy and paste the contents of the corresponding `*_down.sql` file
4. Run the SQL

## Migration Order

Migrations should be applied in numerical order:
1. `001_create_polls_table_up.sql`

## Notes

- Always test migrations on a development database first
- Keep backups before applying migrations to production
- Row Level Security (RLS) is enabled by default for security