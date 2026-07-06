#!/usr/bin/env node
/*
 * Clustering regression gate (integration plan P2.7).
 *
 * Runs the OFFLINE accuracy harness (fixtures — free, deterministic, no API
 * key needed) and FAILS if `descriptor-improved` regresses below its measured
 * bar on the 36-photo/9-item ground truth:
 *   precision = 1.00   (a conservative merger must never false-merge)
 *   wrong-auto-accept = 0   (never auto-accept a group mixing >=2 real items)
 *
 * descriptor-improved is the gate target because it's the always-available
 * fallback — batched-vision needs a live call, so its gate is the separate
 * ./run-stability-check.sh (run that after any change to its prompt/model).
 *
 * Usage:  npm run clustering:gate     (there is no CI — this repo isn't a git
 * repo — so run this before shipping any change to pipeline/cluster.js,
 * pipeline/groupingStrategy.js, or the fixtures.)
 *
 * Config knobs the pipeline respects (documented here per plan P1.6):
 *   $GROUPING_STRATEGY  batched-vision (default) | descriptor-improved |
 *                       descriptor-haiku | batched-haiku | baseline |
 *                       embedding-voyage | embedding-clip
 *   $CLUSTER_MODEL      Anthropic model id for vision calls (default opus)
 */

const { execFileSync } = require('child_process');
const path = require('path');

const BAR = { precision: 1.0, wrongAutoAccept: 0 };
const STRATEGY = 'descriptor-improved';

let out;
try {
  out = execFileSync(process.execPath, [path.join(__dirname, 'harness.js'), '--json', `--strategies=${STRATEGY}`], {
    encoding: 'utf8',
  });
} catch (e) {
  console.error('GATE ERROR: harness run failed:', e.message);
  process.exit(2);
}

let results;
try {
  results = JSON.parse(out);
} catch {
  console.error('GATE ERROR: harness --json output was not parseable JSON. Output was:\n' + out.slice(0, 800));
  process.exit(2);
}

const r = (Array.isArray(results) ? results : results.results || []).find((x) => x.name === STRATEGY);
const m = r && (r.metrics || r.m);
if (!r || r.error || !m) {
  console.error(`GATE ERROR: no result for ${STRATEGY}${r && r.error ? ` (${r.error})` : ''}`);
  process.exit(2);
}

const failures = [];
if (m.precision < BAR.precision) failures.push(`precision ${m.precision.toFixed(3)} < ${BAR.precision.toFixed(2)}`);
if (m.wrongAutoAccept > BAR.wrongAutoAccept) failures.push(`wrong-auto-accept ${m.wrongAutoAccept} > ${BAR.wrongAutoAccept}`);

if (failures.length) {
  console.error(`❌ CLUSTERING GATE FAILED (${STRATEGY}): ${failures.join('; ')}`);
  console.error('   A conservative merger must not false-merge. Fix the regression before shipping.');
  process.exit(1);
}
console.log(
  `✅ clustering gate passed: ${STRATEGY} P=${m.precision.toFixed(2)} R=${(m.recall ?? 0).toFixed(2)} wrong-AA=${m.wrongAutoAccept}`
);
