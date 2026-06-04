#!/usr/bin/env bash
# Update the bundled models.dev cache used by bedrock-client.ts.
# Run this periodically (e.g. weekly) to pick up new Bedrock models.
#
# Usage: ./scripts/update-models-cache.sh
# Then commit the updated src/models-dev-cache.json.

set -euo pipefail

CACHE_FILE="src/models-dev-cache.json"
URL="https://models.dev/api.json"

echo "Fetching $URL ..."
FULL=$(curl -fsSL "$URL")

# Extract only the amazon-bedrock section to keep the file small
python3 - <<'EOF'
import sys, json

with open('/dev/stdin') as f:
    data = json.load(f)

bedrock = data.get('amazon-bedrock')
if not bedrock:
    print("ERROR: amazon-bedrock section not found in models.dev response", file=sys.stderr)
    sys.exit(1)

output = json.dumps({'amazon-bedrock': bedrock}, separators=(',', ':'), sort_keys=True)
print(output)
EOF
<<< "$FULL" > "$CACHE_FILE"

MODEL_COUNT=$(python3 -c "import json; d=json.load(open('$CACHE_FILE')); print(len(d['amazon-bedrock'].get('models', {})))")
echo "Done. $MODEL_COUNT models written to $CACHE_FILE"
echo "Review the diff and commit: git add $CACHE_FILE && git commit -m 'chore: update models.dev cache'"
