# Database Migrations

This directory contains SQL migration files for the WhoeverWants application database.

## Migration Order

Apply migrations in numerical order:

1. **001_create_polls_table** - Creates the main polls table
2. **002_create_polls_rls_policies** - Sets up Row Level Security policies for polls
3. **003_add_poll_type_and_options** - Adds poll_type and options columns for ranked choice support
4. **004_create_votes_table** - Creates the votes table for storing poll responses
5. **005_create_poll_results_view** - Creates view for aggregated poll results (Yes/No only)
6. **006_create_ranked_choice_rounds_table** - Creates table for storing elimination rounds
7. **007_create_ranked_choice_function** - Creates PostgreSQL function for ranked choice calculations
8. **008_update_poll_results_view** - Safely updates view with CREATE OR REPLACE (no destructive operations)
9. **009_fix_ranked_choice_rls_v2** - Fixes Row Level Security for ranked choice function operations (use v2)
10. **010_fix_array_handling** - Fixes PostgreSQL array handling issues in ranked choice function

## How to Apply Migrations

1. Open your Supabase Dashboard
2. Go to the SQL Editor
3. Copy and paste the content of each `*_up.sql` file
4. Execute them in order

## Ranked Choice Voting Implementation

The ranked choice voting system works as follows:

1. **Vote Storage**: Ranked choices are stored as JSON arrays in the `votes.ranked_choices` column
2. **Elimination Algorithm**: The `calculate_ranked_choice_winner()` function implements instant runoff voting:
   - Counts 1st choice votes for each option
   - Eliminates the option with the fewest votes
   - Redistributes votes to next highest non-eliminated choice
   - Repeats until a winner is found
3. **Round Storage**: Each elimination round is stored in `ranked_choice_rounds` table
4. **Results Aggregation**: The `poll_results` view automatically calculates winners for both poll types

## Database Schema

### Tables
- `polls` - Poll metadata and configuration
- `votes` - Individual vote submissions (private)
- `ranked_choice_rounds` - Elimination round results (public)

### Views
- `poll_results` - Aggregated results without exposing individual votes

### Functions
- `calculate_ranked_choice_winner(UUID)` - Performs ranked choice elimination algorithm with SECURITY DEFINER

## Security

- Row Level Security (RLS) is enabled on all tables
- Individual votes are never exposed to clients
- Only aggregated results are accessible via the `poll_results` view
- Ranked choice rounds show vote counts per option per round, maintaining privacy
- The `calculate_ranked_choice_winner` function uses `SECURITY DEFINER` to safely manage elimination rounds
- Public users can read results but cannot directly modify elimination data