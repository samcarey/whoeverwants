#!/bin/bash
set -e

source .env

SQL=$(cat database/migrations/056_add_auto_close_participation_trigger_up.sql)

JSON_PAYLOAD=$(jq -n --arg query "$SQL" '{"query": $query}')

curl -s "https://api.supabase.com/v1/projects/kfngceqepnzlljkwedtd/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$JSON_PAYLOAD" | jq
