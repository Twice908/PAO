#!/usr/bin/env bash
# Polls Railway's GraphQL API for a service's latest deployment and exits
# non-zero unless it reaches SUCCESS. Railway's GitHub integration triggers
# the actual deploy on push to main; this script only confirms it landed,
# so CI fails loudly instead of the deploy silently breaking.
#
# Usage: verify-railway-deploy.sh <service-id>
# Requires env: RAILWAY_TOKEN, RAILWAY_PROJECT_ID
set -euo pipefail

SERVICE_ID="${1:?Usage: verify-railway-deploy.sh <service-id>}"
: "${RAILWAY_TOKEN:?RAILWAY_TOKEN is not set}"
: "${RAILWAY_PROJECT_ID:?RAILWAY_PROJECT_ID is not set}"

MAX_ATTEMPTS=30
SLEEP_SECONDS=15

QUERY='query($projectId: String!, $serviceId: String!) {
  deployments(
    input: { projectId: $projectId, serviceId: $serviceId }
    first: 1
  ) {
    edges {
      node {
        id
        status
        createdAt
      }
    }
  }
}'

for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  RESPONSE=$(curl -sS \
    -X POST "https://backboard.railway.app/graphql/v2" \
    -H "Authorization: Bearer $RAILWAY_TOKEN" \
    -H "Content-Type: application/json" \
    --data "$(node -e "
      console.log(JSON.stringify({
        query: process.argv[1],
        variables: { projectId: process.argv[2], serviceId: process.argv[3] },
      }))
    " "$QUERY" "$RAILWAY_PROJECT_ID" "$SERVICE_ID")")

  STATUS=$(echo "$RESPONSE" | node -e "
    const data = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    if (data.errors) {
      console.error(JSON.stringify(data.errors));
      process.exit(2);
    }
    const edge = data.data?.deployments?.edges?.[0];
    console.log(edge ? edge.node.status : 'UNKNOWN');
  ")

  echo "Attempt $attempt/$MAX_ATTEMPTS — service $SERVICE_ID deployment status: $STATUS"

  case "$STATUS" in
    SUCCESS)
      exit 0
      ;;
    FAILED|CRASHED|REMOVED)
      echo "Railway deployment for service $SERVICE_ID ended in status $STATUS."
      exit 1
      ;;
  esac

  sleep "$SLEEP_SECONDS"
done

echo "Timed out waiting for service $SERVICE_ID to reach SUCCESS."
exit 1
