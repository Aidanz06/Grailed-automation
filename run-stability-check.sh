#!/usr/bin/env bash
#
# Stability check for batched-vision (run on the Mac).
#
#   ./run-stability-check.sh [RUNS]        # default 5
#
# Runs the default grouping strategy N times with a fresh call each time and reports
# whether the partition is stable + safe. Each batched-vision run is ~$0.24.

set -uo pipefail
cd "$(dirname "$0")"
RUNS="${1:-5}"

if [ -f .env.local ]; then source .env.local; else echo "!! .env.local not found"; exit 1; fi
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then echo "!! ANTHROPIC_API_KEY not set"; exit 1; fi

echo "-- preflighting Anthropic key ..."
code=$(curl -sS -o /dev/null -m 20 -w "%{http_code}" https://api.anthropic.com/v1/messages \
  -H "x-api-key: ${ANTHROPIC_API_KEY}" -H "anthropic-version: 2023-06-01" -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":8,"messages":[{"role":"user","content":"hi"}]}' 2>/dev/null)
[ "$code" = "200" ] || { echo "!! key preflight failed (HTTP $code)"; exit 1; }
echo "-- key OK. Running ${RUNS} stability runs of batched-vision ..."
echo

node pipeline/stability.js --strategy=batched-vision --runs="$RUNS"
