#!/bin/bash

# Pinggy Pro tunnel script
# This script starts a Pinggy tunnel with Pro account features

# Check if PINGGY_TOKEN is set
if [ -z "$PINGGY_TOKEN" ]; then
    echo "⚠️  PINGGY_TOKEN not set. Using free tunnel (60 minute limit)."
    echo "To use your Pro account, set PINGGY_TOKEN environment variable:"
    echo "  export PINGGY_TOKEN=your_token_here"
    echo ""
    # Use free tunnel with subdomain attempt
    ssh -p 443 -R0:localhost:3000 -o StrictHostKeyChecking=no decisionbot.a.pinggy.link@a.pinggy.io
else
    echo "🔑 Using Pinggy Pro with token authentication"
    # Use authenticated tunnel with token
    ssh -p 443 -R0:localhost:3000 -o StrictHostKeyChecking=no ${PINGGY_TOKEN}:decisionbot.a.pinggy.link@a.pinggy.io
fi