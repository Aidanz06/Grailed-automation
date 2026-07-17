#!/usr/bin/env node
/*
 * Aggregate test runner — the offline health suite (no API key, no real photos,
 * free). One command locally AND the thing the scheduled CI runs. Chains the
 * deterministic suites, prints a clean summary, and exits non-zero if any GATED
 * suite fails.
 *
 *   node pipeline/test-all.js         # run the offline suite
 *   npm run test:offline
 *
 * The LIVE AI accuracy evals (identify/comps against real photos + a real key)
 * are deliberately NOT here — they cost money and need committed fixtures; run
 * them on demand (npm run test:identify) or via the manual CI job.
 */
const { execSync } = require('child_process');

const STEPS = [
  { name: 'unit tests', cmd: 'npm run test:unit', gate: true },
  { name: 'clustering gate', cmd: 'npm run clustering:gate', gate: true },
  { name: 'comp-recall eval (dry-run, canned real comps)', cmd: 'npm run test:comps:dry', gate: true },
  { name: 'identify harness smoke (dry-run)', cmd: 'node pipeline/eval/identify.js --dry-run', gate: true },
];

const results = [];
for (const s of STEPS) {
  process.stdout.write(`\n\x1b[1m▶ ${s.name}\x1b[0m  (${s.cmd})\n`);
  try {
    execSync(s.cmd, { stdio: 'inherit', cwd: process.cwd() });
    results.push({ ...s, ok: true });
  } catch {
    results.push({ ...s, ok: false });
  }
}

console.log('\n════════ offline suite summary ════════');
let failed = 0;
for (const r of results) {
  const ok = r.ok;
  if (!ok && r.gate) failed++;
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : (r.gate ? '\x1b[31mFAIL\x1b[0m' : '\x1b[33mWARN\x1b[0m')}  ${r.name}`);
}
console.log(`\n${failed === 0 ? '\x1b[32mAll gated suites passed.\x1b[0m' : `\x1b[31m${failed} gated suite(s) failed.\x1b[0m`}`);
process.exit(failed === 0 ? 0 : 1);
