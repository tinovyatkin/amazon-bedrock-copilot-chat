#!/usr/bin/env bash
# Update the bundled models.dev cache used by bedrock-client.ts.
# Run this periodically (e.g. weekly) to pick up new Bedrock models.
#
# Usage: ./scripts/update-models-cache.sh
# Then commit the updated src/models-dev-cache.json.

set -euo pipefail

CACHE_FILE="src/models-dev-cache.json"
URL="https://models.dev/api.json"
TEMP_FILE=$(mktemp)

trap "rm -f '$TEMP_FILE'" EXIT

echo "Fetching $URL ..."
curl -fsSL "$URL" > "$TEMP_FILE"

# Extract only the amazon-bedrock section to keep the file small
python3 <<PYTHON_EOF
import sys, json

try:
    with open('$TEMP_FILE', 'r') as f:
        data = json.load(f)
except json.JSONDecodeError as e:
    print(f"ERROR: Invalid JSON from models.dev: {e}", file=sys.stderr)
    sys.exit(1)

bedrock = data.get('amazon-bedrock')
if not bedrock:
    print("ERROR: amazon-bedrock section not found in models.dev response", file=sys.stderr)
    sys.exit(1)

output = json.dumps({'amazon-bedrock': bedrock}, indent=2, sort_keys=True)
with open('$CACHE_FILE', 'w') as f:
    f.write(output)

MODEL_COUNT = len(bedrock.get('models', {}))
print(f"Done. {MODEL_COUNT} models written to $CACHE_FILE")
PYTHON_EOF

echo "Review the diff and commit: git add $CACHE_FILE && git commit -m 'chore: update models.dev cache'"
