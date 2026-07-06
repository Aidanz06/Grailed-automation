#!/usr/bin/env bash
#
# Turnkey live benchmark for the photo-clustering strategies (run on the Mac).
#
#   ./run-clustering-benchmark.sh
#
# What it does:
#   1. Loads .env.local and preflights the Anthropic key (stops if it's rejected —
#      no point spending or waiting on a bad key).
#   2. Runs the accuracy harness LIVE across the strategies that ride your EXISTING
#      Anthropic key (baseline, descriptor-improved, descriptor-haiku, batched-vision,
#      batched-haiku). Descriptors are cached under grailed-vision-test/.harness-cache
#      so re-runs don't re-spend.
#   3. If VOYAGE_API_KEY is set, also benchmarks embedding-voyage.
#      If @huggingface/transformers is installed, also benchmarks embedding-clip.
#   4. Writes grailed-vision-test/harness-results.live.json and prints the decision rule.
#
# Nothing here submits to Grailed or touches the browser/autofill — it's the
# clustering pipeline only.

set -uo pipefail
cd "$(dirname "$0")"

echo "== Photo-clustering live benchmark =="

# --- 1. env + key preflight -------------------------------------------------
if [ -f .env.local ]; then
  # shellcheck disable=SC1091
  source .env.local
else
  echo "!! .env.local not found. Create it with: export ANTHROPIC_API_KEY=sk-ant-..."
  exit 1
fi

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "!! ANTHROPIC_API_KEY is not set in .env.local."
  exit 1
fi

echo "-- preflighting Anthropic key ..."
code=$(curl -sS -o /dev/null -m 20 -w "%{http_code}" https://api.anthropic.com/v1/messages \
  -H "x-api-key: ${ANTHROPIC_API_KEY}" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":8,"messages":[{"role":"user","content":"hi"}]}' 2>/dev/null)

if [ "$code" = "401" ] || [ "$code" = "403" ]; then
  echo "!! Anthropic rejected the key (HTTP $code). Regenerate ANTHROPIC_API_KEY at"
  echo "   console.anthropic.com, update .env.local, and re-run."
  echo "   (This is a genuine Anthropic verdict — unlike the build sandbox, your Mac has no"
  echo "    proxy in the way, so a 401 here really is the key.)"
  exit 1
elif [ "$code" != "200" ]; then
  echo "!! Unexpected preflight status HTTP $code. Check connectivity, then re-run."
  exit 1
fi
echo "-- key OK (HTTP 200)."

# --- 2. LLM strategies (existing key) --------------------------------------
LLM_STRATS="baseline,descriptor-improved,descriptor-haiku,batched-vision,batched-haiku"
echo
echo "-- running LLM strategies: $LLM_STRATS"
node pipeline/harness.js --live --strategies="$LLM_STRATS" \
  --out=grailed-vision-test/harness-results.live.json

# --- 3. optional embedding strategies --------------------------------------
if [ -n "${VOYAGE_API_KEY:-}" ]; then
  echo
  echo "-- VOYAGE_API_KEY set: benchmarking embedding-voyage"
  node pipeline/harness.js --live --strategies=embedding-voyage \
    --out=grailed-vision-test/harness-results.voyage.json
else
  echo
  echo "-- (skipping embedding-voyage: VOYAGE_API_KEY not set)"
fi

if node -e "require.resolve('@huggingface/transformers')" >/dev/null 2>&1; then
  echo
  echo "-- @huggingface/transformers found: benchmarking embedding-clip (on-device)"
  node pipeline/harness.js --live --strategies=embedding-clip \
    --out=grailed-vision-test/harness-results.clip.json
else
  echo
  echo "-- (skipping embedding-clip: run \`npm i @huggingface/transformers\` to include it)"
fi

# --- 4. decision rule -------------------------------------------------------
cat <<'RULE'

============================ HOW TO PICK ============================
Baseline for comparison = descriptor-improved (current default).
Adopt a challenger ONLY if ALL of these hold:
  1. WRONG-AA == 0            (never regress safety — hard gate)
  2. precision (P) >= descriptor-improved's P   (no accuracy regression)
  3. it wins on a secondary axis:
       - latency: materially lower `ms`, OR
       - cost:    lower `est$`, OR
       - robustness: higher R / completeness on HARDER shoots
Otherwise keep descriptor-improved.

Likely outcome on the current 15-photo set: descriptor-improved is already
perfect here, so batched/embeddings can't show an ACCURACY gain — they can only
win on latency/cost. For a real robustness decision, add 1-2 more shoots
(esp. a genuine multi-item photo + two visually-similar distinct items) to
grailed-vision-test/ground-truth.json and re-run.

To flip the default: set DEFAULT_STRATEGY in pipeline/cluster.js (or export
GROUPING_STRATEGY=<name>) to the winner.
====================================================================
RULE
