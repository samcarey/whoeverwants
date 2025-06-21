# Test Database Setup

This document explains how to set up an automated test database for development and testing purposes.

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Create test environment file:**
   ```bash
   cp .env.test.example .env.test
   ```

3. **Configure your test database credentials in `.env.test`**

4. **Run the setup script:**
   ```bash
   npm run db:setup-test
   ```

## Setup Options

### Option 1: Separate Supabase Project (Recommended)

Create a dedicated Supabase project for testing:

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Copy the URL and anon key to `.env.test`
3. Generate a service role key and add it to `.env.test`
4. Run `npm run db:setup-test`

### Option 2: Supabase Database Branching

Use Supabase CLI to create database branches:

```bash
# Install Supabase CLI
npm install -g supabase

# Create a test branch
supabase branches create test-db

# Get branch connection details
supabase branches list
```

## Available Scripts

- `npm run db:setup-test` - Set up test database with schema and seed data
- `npm run db:setup-test-clean` - Clean setup (drops existing tables first)
- `npm run db:seed-test` - Same as clean setup (legacy alias)

## Script Options

The setup script accepts these command-line options:

- `--clear` - Drop existing tables before setup
- `--no-seed` - Skip seeding test data

Examples:
```bash
# Full setup with clean slate
npm run db:setup-test-clean

# Setup schema only, no test data
node scripts/setup-test-db.js --no-seed

# Clean setup with test data
node scripts/setup-test-db.js --clear
```

## Environment Variables

Create `.env.test` with these variables:

```env
# Test Database (separate project)
NEXT_PUBLIC_SUPABASE_TEST_URL=https://your-test-project.supabase.co
NEXT_PUBLIC_SUPABASE_TEST_ANON_KEY=your-test-anon-key
SUPABASE_TEST_SERVICE_KEY=your-test-service-key
```

The script will fall back to your main database credentials if test-specific ones aren't provided.

## What the Script Does

1. **Validates Environment** - Checks for required credentials
2. **Clears Database** - Drops existing tables (if `--clear` flag used)
3. **Runs Migrations** - Applies all database migrations from `database/migrations/`
4. **Sets Up Security** - Enables RLS and applies policies
5. **Seeds Test Data** - Inserts sample polls for testing
6. **Verifies Setup** - Confirms everything is working

## Test Data

The script seeds these sample polls:
- "What should we have for lunch?"
- "Best programming language for beginners?"
- "Favorite season of the year?"
- "Should we work from home or office?"
- "Best way to learn new skills?"

## Using Test Database in Your App

To use the test database in your application:

1. Copy your test database credentials to `.env.local`
2. Or create a separate environment configuration
3. Update `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Schema Synchronization

When your database schema changes:

1. Create new migration files in `database/migrations/`
2. Update the setup script if needed
3. Run `npm run db:setup-test-clean` to rebuild the test database

## Troubleshooting

**"Migration failed" errors:**
- Ensure your service role key has sufficient permissions
- Check that the migration SQL files are valid
- Verify the database connection

**"Seeding failed" errors:**
- Confirm the polls table was created successfully
- Check that RLS policies allow INSERT operations
- Verify the table structure matches the seed data

**Permission errors:**
- Use the service role key, not the anon key
- Ensure the service role has admin permissions in Supabase

## Security Notes

- Never commit `.env.test` to version control
- Use separate Supabase projects for production and testing
- Service role keys should be kept secure and not exposed to client-side code
- The test database should have the same security policies as production