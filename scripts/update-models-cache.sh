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

trap 'rm -f "$TEMP_FILE"' EXIT

echo "Fetching $URL ..."
curl --connect-timeout 10 --max-time 60 -fsSL "$URL" > "$TEMP_FILE"

# Extract only the amazon-bedrock section to keep the file small
python3 <<PYTHON_EOF
import os, sys, json, tempfile

try:
    with open('$TEMP_FILE', 'r') as f:
        data = json.load(f)
except json.JSONDecodeError as e:
    print(f"ERROR: Invalid JSON from models.dev: {e}", file=sys.stderr)
    sys.exit(1)

bedrock = data.get('amazon-bedrock')
if not isinstance(bedrock, dict):
    print("ERROR: amazon-bedrock section not found or not an object in models.dev response", file=sys.stderr)
    sys.exit(1)

models = bedrock.get('models')
if not isinstance(models, dict):
    print("ERROR: amazon-bedrock.models is missing or not an object in models.dev response", file=sys.stderr)
    sys.exit(1)

output = json.dumps({'amazon-bedrock': bedrock}, indent=2, sort_keys=True)

# Write atomically: build the file next to the destination (unique per
# invocation so concurrent runs don't race on the same temp path), then
# rename it into place so a crash or interruption never leaves a truncated
# cache.
cache_dir = os.path.dirname(os.path.abspath('$CACHE_FILE')) or '.'
fd, tmp_cache = tempfile.mkstemp(dir=cache_dir, prefix='.models-dev-cache-', suffix='.tmp')
try:
    with os.fdopen(fd, 'w') as f:
        f.write(output)
    os.replace(tmp_cache, '$CACHE_FILE')
except BaseException:
    if os.path.exists(tmp_cache):
        os.remove(tmp_cache)
    raise

MODEL_COUNT = len(models)
print(f"Done. {MODEL_COUNT} models written to $CACHE_FILE")
PYTHON_EOF

echo "Review the diff and commit: git add $CACHE_FILE && git commit -m 'chore: update models.dev cache'"
