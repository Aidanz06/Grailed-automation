#!/usr/bin/env node
/*
 * Batch intake + MVP flow (PRD §5.1 → §4/§5.5).
 *
 *   node pipeline/batch-cli.js <folder> [--run] [--save] [--mock] [--json]
 *
 * Default:  group the folder's photos into per-item groups and print a summary.
 * --run:    additionally run the full pipeline (attributes → comps → content) on each
 *           AUTO-ACCEPT group and persist a draft item; flagged groups are saved as
 *           'needs_review' and left for the human (never auto-processed). Implies save.
 * --save:   (grouping only) persist each group as a draft/needs_review item.
 * --mock:   use synthetic comps in --run mode.
 * --json:   emit full JSON instead of the readable summary.
 *
 * A shared comp provider spans the whole batch, so one cache + rate-limiter +
 * circuit-breaker covers every group. Nothing is ever submitted to Grailed — the
 * output is editable drafts for manual review (§4).
 *
 * Env: ANTHROPIC_API_KEY (required); GRAILED_ALGOLIA_KEY for live comps in --run.
 */

const { groupBatch } = require('./cluster');
const { processItem, makeCompProvider } = require('./processItem');
const { openStore, DEFAULT_DB } = require('./store');

async function main() {
  const args = process.argv.slice(2);
  const folder = args.find((a) => !a.startsWith('--'));
  const run = args.includes('--run');
  const save = args.includes('--save') || run;
  const mock = args.includes('--mock');
  const asJson = args.includes('--json');

  if (!folder) {
    console.error('usage: node pipeline/batch-cli.js <folder> [--run] [--save] [--mock] [--json]');
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ERROR: ANTHROPIC_API_KEY is not set.');
    process.exit(1);
  }

  console.error(`Describing + grouping photos in ${folder}…`);
  const { photoCount, groups } = await groupBatch(folder);
  console.error(`${photoCount} photos → ${groups.length} group(s).`);

  const store = save ? openStore() : null;
  const processed = [];

  // Shared provider so cache/rate-limit/breaker span the whole batch.
  const shared = run ? makeCompProvider({ mock }) : null;

  for (const g of groups) {
    const base = { photos: g.photos.map((p) => ({ file_path: p, cluster_confidence: g.confidence })), flags: g.flags };

    if (run && g.autoAccept) {
      console.error(`\n[group ${g.groupId}] "${g.signature}" — processing…`);
      const item = await processItem(g.photos, {
        provider: shared.provider,
        providerName: shared.providerName,
        content: true,
        label: `[group ${g.groupId}]`,
      });
      // base last so its confidence-annotated photos + flags win over item.photos (plain paths)
      const rec = { ...item, ...base, status: 'draft' };
      const id = store ? store.saveItemRun(rec) : null;
      processed.push({ groupId: g.groupId, itemId: id, status: 'draft', title: item.content?.title, range: item.range });
    } else {
      // flagged / low-confidence group OR grouping-only save: persist unprocessed for review
      const status = g.autoAccept ? 'grouped' : 'needs_review';
      const id = store ? store.saveItemRun({ ...base, status }) : null;
      processed.push({ groupId: g.groupId, itemId: id, status, signature: g.signature, flags: g.flags });
      if (run && !g.autoAccept) console.error(`\n[group ${g.groupId}] "${g.signature}" — flagged (${g.flags.join(', ')}), left for review.`);
    }
  }
  if (store) store.close();

  if (asJson) {
    process.stdout.write(JSON.stringify({ photoCount, groups, processed }, null, 2) + '\n');
  } else {
    console.log('');
    for (const g of groups) {
      const rec = processed.find((p) => p.groupId === g.groupId);
      const tag = g.autoAccept ? '✓ auto-accept' : `⚠ review (${g.flags.join(', ') || 'low confidence'})`;
      console.log(`Group ${g.groupId}  [${tag}]  conf ${g.confidence}${rec?.itemId ? `  → item #${rec.itemId} (${rec.status})` : ''}`);
      console.log(`  "${g.signature}"`);
      if (rec?.title) console.log(`  title: ${rec.title}`);
      if (rec?.range && rec.range.median != null) console.log(`  price: $${rec.range.low}–${rec.range.high} (median $${rec.range.median})`);
      g.photos.forEach((p) => console.log(`  - ${p}`));
      console.log('');
    }
    const drafts = processed.filter((p) => p.status === 'draft').length;
    const review = processed.filter((p) => p.status === 'needs_review').length;
    if (run) console.log(`Done: ${drafts} draft(s) ready to review, ${review} group(s) need manual review first.`);
    if (store) console.log(`Saved to ${DEFAULT_DB}.`);
  }
}

main().catch((e) => { console.error('batch error:', e && e.message ? e.message : e); process.exit(1); });
