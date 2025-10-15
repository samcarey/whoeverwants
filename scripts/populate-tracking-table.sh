#!/bin/bash

set -e

echo "Populating migrations tracking table with already-applied migrations..."

# Load environment variables
source .env

URL="$NEXT_PUBLIC_SUPABASE_URL_TEST"
ACCESS_TOKEN="$SUPABASE_ACCESS_TOKEN"
PROJECT_REF=$(echo "$URL" | sed 's|https://||' | sed 's|.supabase.co||')

# SQL to populate tracking table
SQL="INSERT INTO _migrations (filename, applied_at)
SELECT filename, NOW() - INTERVAL '1 day'
FROM (VALUES
  ('001_create_polls_table_up.sql'),
  ('002_add_response_deadline_up.sql'),
  ('003_add_poll_type_and_options_up.sql'),
  ('004_create_votes_table_up.sql'),
  ('005_create_poll_results_view_up.sql'),
  ('006_create_ranked_choice_rounds_table_up.sql'),
  ('007_add_creator_secret_up.sql'),
  ('008_create_ranked_choice_function_up.sql'),
  ('009_update_poll_results_view_up.sql'),
  ('010_fix_ranked_choice_rls_v2_up.sql'),
  ('011_fix_array_handling_up.sql'),
  ('012_fix_remaining_options_bug_up.sql'),
  ('013_add_is_closed_field_up.sql'),
  ('014_fix_ranked_choice_bug_up.sql'),
  ('015_add_polls_update_policy_up.sql'),
  ('016_add_follow_up_to_polls_up.sql'),
  ('016_add_private_polls_up.sql'),
  ('016_add_voter_name_up.sql'),
  ('016_create_poll_access_tracking_up.sql'),
  ('016_fix_ranked_choice_zero_votes_up.sql'),
  ('016_fix_votes_update_policy_up.sql'),
  ('017_create_poll_discovery_function_up.sql'),
  ('017_fix_zero_vote_elimination_bug_up.sql'),
  ('018_enable_realtime_on_polls_up.sql'),
  ('018_fix_poll_results_winner_for_ranked_choice_up.sql'),
  ('019_add_borda_count_tie_breaking_up.sql'),
  ('019_fix_bidirectional_poll_discovery_up.sql'),
  ('020_add_borda_scores_to_rounds_up.sql'),
  ('020_emergency_add_short_id_up.sql'),
  ('021_add_sequential_id_and_short_id_up.sql'),
  ('021_improve_incomplete_ballot_handling_up.sql'),
  ('022_fix_irv_sql_scope_up.sql'),
  ('023_fix_borda_tiebreaker_logic_up.sql'),
  ('024_fix_private_poll_short_id_up.sql'),
  ('025_enable_polls_rls_security_up.sql'),
  ('026_fix_polls_rls_policy_up.sql'),
  ('027_add_poll_access_insert_function_up.sql'),
  ('028_emergency_rls_fix_up.sql'),
  ('029_remove_rls_system_up.sql'),
  ('030_remove_public_polls_up.sql'),
  ('031_add_vote_update_policy_up.sql'),
  ('032_fix_vote_update_policy_up.sql'),
  ('033_add_abstain_to_votes_up.sql'),
  ('034_fix_vote_constraint_for_abstain_up.sql'),
  ('035_fix_ranked_choice_constraint_for_abstain_up.sql'),
  ('036_fix_ranked_choice_abstain_handling_up.sql'),
  ('037_fix_remaining_options_variable_up.sql'),
  ('038_fix_latest_ranked_choice_abstain_up.sql'),
  ('039_fix_borda_count_abstain_up.sql'),
  ('040_add_creator_name_up.sql'),
  ('041_add_fork_relationship_up.sql'),
  ('042_add_nomination_poll_type_up.sql'),
  ('043_add_nominations_column_up.sql'),
  ('044_fix_nomination_abstain_constraint_up.sql'),
  ('045_fix_round_1_tie_breaking_up.sql'),
  ('046_fix_majority_calculation_for_exhausted_ballots_up.sql'),
  ('047_fix_outdated_vote_constraint_up.sql'),
  ('047_fix_vote_update_rls_policy_up.sql'),
  ('048_fix_vote_type_check_constraint_up.sql'),
  ('049_add_updated_at_to_votes_up.sql'),
  ('050_fix_nomination_abstain_constraint_up.sql'),
  ('051_add_participation_poll_type_up.sql'),
  ('052_fix_poll_type_constraint_up.sql'),
  ('053_add_participation_vote_structure_up.sql'),
  ('054_add_participation_to_poll_results_view_up.sql')
) AS t(filename)
ON CONFLICT (filename) DO NOTHING;"

# Create JSON payload
JSON_PAYLOAD=$(jq -n --arg query "$SQL" '{"query": $query}')

# Execute SQL via Management API
echo "Executing SQL..."
response=$(curl -s -w "\n%{http_code}" \
    -X POST "https://api.supabase.com/v1/projects/$PROJECT_REF/database/query" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$JSON_PAYLOAD")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n-1)

if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
    echo "✅ Successfully populated tracking table (HTTP $http_code)"
    echo "Now run: npm run db:migrate"
else
    echo "❌ Failed to populate tracking table (HTTP $http_code)"
    echo "Response: $body"
    exit 1
fi
