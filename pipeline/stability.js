#!/usr/bin/env node
/*
 * Stability check for a grouping strategy (esp. batched-vision, whose single
 * generative call can partition differently run-to-run — see the research brief).
 *
 *   node pipeline/stability.js [--strategy=batched-vision] [--runs=5]
 *
 * Runs the strategy N times against the labeled 36-photo set with a FRESH call each
 * time (no caching), and reports:
 *   - per-run: groups, exact-item matches, precision, recall, wrong-auto-accept, seconds
 *   - how many DISTINCT partitions appeared across the runs (1 = perfectly stable)
 *   - how many runs recovered the ground truth exactly
 *   - whether any run produced a wrong auto-accept (the safety gate)
 *   - total estimated spend
 *
 * Env: ANTHROPIC_API_KEY (source .env.local first). Each batched-vision run is ~$0.24.
 */

const path = require('path');
const gs = require('./groupingStrategy');
const { loadGroundTruth, evalGrouping } = require('./harness');

function canonicalPartition(groups, absOrder) {
  const predByAbs = new Map();
  groups.forEach((g) => g.photos.forEach((p) => predByAbs.set(path.resolve(p), g.groupId)));
  const seq = absOrder.map((a) => predByAbs.get(path.resolve(a)));
  // relabel group ids by first appearance so equivalent partitions get the same string
  const relabel = new Map(); let next = 0;
  return seq.map((x) => { if (!relabel.has(x)) relabel.set(x, next++); return relabel.get(x); }).join('-');
}

async function main() {
  const args = process.argv.slice(2);
  const runs = Number((args.find((a) => a.startsWith('--runs=')) || '--runs=5').split('=')[1]);
  const name = (args.find((a) => a.startsWith('--strategy=')) || '--strategy=batched-vision').split('=')[1];

  if (!process.env.ANTHROPIC_API_KEY) { console.error('ERROR: ANTHROPIC_API_KEY not set (source .env.local).'); process.exit(1); }

  const { abs, truth } = loadGroundTruth();
  const truthItems = new Set(truth).size;
  const truthByAbs = new Map(abs.map((a, i) => [path.resolve(a), truth[i]]));

  console.log(`Stability: ${name} × ${runs} runs, ${abs.length} photos / ${truthItems} items\n`);

  const sigs = new Map();          // partition signature -> count
  const perfect = [];              // runs that recovered ground truth exactly
  let worstWrongAA = 0;
  let totalCost = 0;
  const rows = [];

  for (let i = 0; i < runs; i++) {
    const strat = gs.makeGroupingStrategy(name, {});
    const t0 = Date.now();
    let groups, meta;
    try {
      ({ groups, meta } = await strat.group(abs, {}));
    } catch (e) {
      console.log(`run ${i + 1}/${runs}: ERROR ${e.message}`);
      continue;
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const m = evalGrouping(groups, abs, truthByAbs);
    const sig = canonicalPartition(groups, abs);
    sigs.set(sig, (sigs.get(sig) || 0) + 1);
    const isPerfect = m.precision === 1 && m.recall === 1;
    if (isPerfect) perfect.push(i + 1);
    worstWrongAA = Math.max(worstWrongAA, m.wrongAutoAccept);
    totalCost += meta && meta.estCostUsd ? meta.estCostUsd : 0;
    rows.push({ run: i + 1, sig });
    console.log(`run ${i + 1}/${runs}: groups=${m.groups}/${truthItems} exact=${m.exactGroupMatches}/${truthItems} P=${m.precision.toFixed(2)} R=${m.recall.toFixed(2)} wrongAA=${m.wrongAutoAccept} ${secs}s${isPerfect ? '  ✓perfect' : ''}`);
  }

  // group runs by partition signature
  const bySig = new Map();
  rows.forEach((r) => { if (!bySig.has(r.sig)) bySig.set(r.sig, []); bySig.get(r.sig).push(r.run); });

  console.log('\n=== stability summary ===');
  console.log(`distinct partitions: ${sigs.size} (1 = perfectly stable)`);
  [...bySig.entries()].sort((a, b) => b[1].length - a[1].length).forEach(([, runsList], idx) => {
    console.log(`  partition ${String.fromCharCode(65 + idx)}: ${runsList.length}/${rows.length} runs  (runs ${runsList.join(', ')})`);
  });
  console.log(`ground-truth-exact runs: ${perfect.length}/${rows.length}${perfect.length ? ` (runs ${perfect.join(', ')})` : ''}`);
  console.log(`worst wrong-auto-accept in any run: ${worstWrongAA}`);
  console.log(`estimated total spend: $${totalCost.toFixed(3)}`);

  const verdict = worstWrongAA > 0
    ? '⚠ SAFETY FLAG — at least one run wrong-auto-accepted. Do not ship batched-vision as-is; keep descriptor-improved or harden the prompt.'
    : sigs.size === 1 && perfect.length === rows.length
      ? '✓ STABLE — identical, correct partition every run. Safe to keep as default.'
      : sigs.size === 1
        ? '~ stable partition but not always ground-truth-exact — inspect which item it splits/merges.'
        : `~ ${sigs.size} partitions across ${rows.length} runs — some run-to-run drift; review the variants before fully trusting it.`;
  console.log(`\nVERDICT: ${verdict}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
