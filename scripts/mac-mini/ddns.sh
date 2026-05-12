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
# Records we keep in sync with the home IP. The wildcard covers per-author
# dev servers and ad-hoc hostnames so they don't need their own CNAMEs.
RECORD_NAMES=(
  "mac-test.dev.whoeverwants.com"
  "*.dev.whoeverwants.com"
)
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

# Build the list of changes for any record whose current value drifted from
# our home IP. AWS allows a single ChangeResourceRecordSets batch with N
# updates, which is preferable to N calls (atomic + cheaper).
changes=""
for RECORD_NAME in "${RECORD_NAMES[@]}"; do
    # Route 53 lookups need the trailing dot; wildcard records are returned
    # with the literal '*' so query and value match by name.
    current_record=$(aws route53 list-resource-record-sets \
        --hosted-zone-id "$HOSTED_ZONE_ID" \
        --query "ResourceRecordSets[?Name == '${RECORD_NAME}.' && Type == 'A'].ResourceRecords[0].Value | [0]" \
        --output text 2>/dev/null || echo "")
    if [ "$current_record" = "$current_ip" ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') $RECORD_NAME unchanged ($current_ip)"
        continue
    fi
    echo "$(date '+%Y-%m-%d %H:%M:%S') updating $RECORD_NAME: ${current_record:-NONE} -> $current_ip"
    if [ -n "$changes" ]; then changes+=","; fi
    changes+="{\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"$RECORD_NAME\",\"Type\":\"A\",\"TTL\":$TTL,\"ResourceRecords\":[{\"Value\":\"$current_ip\"}]}}"
done

if [ -z "$changes" ]; then
    exit 0
fi

aws route53 change-resource-record-sets \
    --hosted-zone-id "$HOSTED_ZONE_ID" \
    --change-batch "{\"Changes\":[$changes]}" > /dev/null
echo "$(date '+%Y-%m-%d %H:%M:%S') done"
