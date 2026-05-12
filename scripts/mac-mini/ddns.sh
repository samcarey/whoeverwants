#!/bin/bash
# Dynamic DNS updater for the Mac mini home IP.
#
# Reads current public IP from one of three providers (fallback chain),
# compares against the A record at Route 53, and UPSERTs only if changed.
# Runs every 5 minutes via ~/Library/LaunchAgents/com.devbox.ddns.plist.
#
# Requires `aws configure` already done with an IAM user that has
# AmazonRoute53FullAccess (or scoped equivalent — see docs/mac-mini-next-steps.md).

set -euo pipefail

HOSTED_ZONE_ID="Z000095423MM09UF7IBWG"
RECORD_NAME="mac-test.dev.whoeverwants.com"
TTL=60
PROVIDERS="https://ifconfig.co https://ipv4.icanhazip.com https://api.ipify.org"

fetch_public_ip() {
    for url in $PROVIDERS; do
        local ip
        ip=$(curl -s --max-time 5 -4 "$url" | tr -d '[:space:]' || true)
        if [[ "$ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
            echo "$ip"
            return 0
        fi
    done
    return 1
}

current_ip=$(fetch_public_ip) || {
    echo "ERROR: couldn't fetch public IP" >&2
    exit 1
}

current_record=$(aws route53 list-resource-record-sets \
    --hosted-zone-id "$HOSTED_ZONE_ID" \
    --query "ResourceRecordSets[?Name == '${RECORD_NAME}.' && Type == 'A'].ResourceRecords[0].Value | [0]" \
    --output text 2>/dev/null || echo "")

if [ "$current_record" = "$current_ip" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') unchanged ($current_ip)"
    exit 0
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') updating $RECORD_NAME: ${current_record:-NONE} -> $current_ip"

aws route53 change-resource-record-sets \
    --hosted-zone-id "$HOSTED_ZONE_ID" \
    --change-batch "{
        \"Changes\": [{
            \"Action\": \"UPSERT\",
            \"ResourceRecordSet\": {
                \"Name\": \"$RECORD_NAME\",
                \"Type\": \"A\",
                \"TTL\": $TTL,
                \"ResourceRecords\": [{\"Value\": \"$current_ip\"}]
            }
        }]
    }" > /dev/null
echo "$(date '+%Y-%m-%d %H:%M:%S') done"
