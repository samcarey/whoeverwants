#!/bin/bash

# Script to send Pushover notifications when Claude needs user input
# Usage: ./scripts/notify-user.sh "message" "title (optional)"

MESSAGE="${1:-Claude has finished the current task and needs your input}"
TITLE="${2:-🤖 Claude Needs Input}"

# Load environment variables
source /home/ubuntu/whoeverwants/.env

# Send notification via Pushover API
curl -X POST https://api.pushover.net/1/messages.json \
  -F "token=${PUSHOVER_APP_TOKEN}" \
  -F "user=${PUSHOVER_USER_KEY}" \
  -F "title=${TITLE}" \
  -F "message=${MESSAGE}" \
  -F "priority=1" \
  -F "sound=magic" \
  -s -o /dev/null

echo "✅ Notification sent: ${MESSAGE}"