#!/usr/bin/env bash
# Confirms a Railway-provisioned datastore (Postgres, Redis) exists and its
# latest deployment is running. These are not built or redeployed by this
# repo's CI on every dispatch — they're provisioned once in Railway and just
# run — so this is a health check, not a deploy step.
#
# Usage: check-railway-datastore.sh <service-id> <label>
# Requires env: RAILWAY_TOKEN, RAILWAY_PROJECT_ID
set -euo pipefail

SERVICE_ID="${1:?Usage: check-railway-datastore.sh <service-id> <label>}"
LABEL="${2:?Usage: check-railway-datastore.sh <service-id> <label>}"
: "${RAILWAY_TOKEN:?RAILWAY_TOKEN is not set}"
: "${RAILWAY_PROJECT_ID:?RAILWAY_PROJECT_ID is not set}"

QUERY='query($projectId: String!, $serviceId: String!) {
  deployments(
    input: { projectId: $projectId, serviceId: $serviceId }
    first: 1
  ) {
    edges {
      node {
        status
      }
    }
  }
}'

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
  console.log(edge ? edge.node.status : 'NOT_FOUND');
")

echo "$LABEL ($SERVICE_ID) status: $STATUS"

if [ "$STATUS" != "SUCCESS" ]; then
  echo "$LABEL is not running (status: $STATUS). Check the Railway dashboard."
  exit 1
fi
