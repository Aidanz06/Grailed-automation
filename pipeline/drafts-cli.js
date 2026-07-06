#!/usr/bin/env node
/*
 * Drafts review + manual-listing bridge.
 *
 *   node pipeline/drafts-cli.js list
 *   node pipeline/drafts-cli.js show <id>
 *   node pipeline/drafts-cli.js export <id>     # copy-paste-ready listing text
 *   node pipeline/drafts-cli.js submit <id>     # mark as manually listed (§10 tracking)
 *
 * This is the interim path to real use while the autofill hand-off (Phase 0b) is
 * gated: run the batch, review drafts here, paste `export` into Grailed by hand,
 * then `submit` to record it. Pure local reads — no API, no browser.
 */

const { openStore } = require('./store');

function fmtPrice(pr) {
  if (!pr || pr.median == null) return '—';
  return `$${pr.median} (range $${pr.low}–$${pr.high}${pr.sampleSize ? `, ${pr.sampleSize} comps` : ''})`;
}

function cmdList(store) {
  const items = store.listItems();
  if (!items.length) return console.log('No items yet. Run: node pipeline/batch-cli.js <folder> --run');
  console.log(`${items.length} item(s):\n`);
  console.log('  ID  STATUS        PRICE            PHOTOS  FLAGS  TITLE');
  for (const it of items) {
    console.log(
      `  #${String(it.id).padEnd(3)} ${String(it.status).padEnd(13)} ${fmtPrice(it.price_range).padEnd(16)} ` +
        `${String(it.photo_count).padEnd(7)} ${String(it.open_flags).padEnd(6)} ${it.title || '(no listing yet)'}`
    );
  }
}

function cmdShow(store, id) {
  const it = store.getItem(id);
  if (!it) return console.error(`No item #${id}.`);
  const a = it.attributes || {};
  const l = it.listing || {};
  console.log(`Item #${it.id}  [${it.status}]  created ${it.created_at}`);
  console.log(`Photos (${it.photos.length}):`);
  it.photos.forEach((p) => console.log(`  - ${p.file_path}${p.cluster_confidence != null ? `  (group conf ${p.cluster_confidence})` : ''}`));
  console.log(`\nAttributes:`);
  console.log(`  resembles: ${a.resembles_brand} (conf ${a.brand_confidence}) | ${a.subcategory || a.category} | ${a.era_style}`);
  console.log(`  color: ${a.primary_color} | size: ${a.size || '—'} | condition: ${a.condition_rating}${a.condition_markers?.length ? ' — ' + a.condition_markers.join(', ') : ''}`);
  console.log(`\nListing:`);
  console.log(`  title: ${l.title || '—'}`);
  console.log(`  tags: ${(l.tags || []).join(', ') || '—'}`);
  console.log(`  price: ${fmtPrice(l.price_range)}`);
  if (l.price_range?.mostRelevantComps?.length) {
    console.log(`  top comps:`);
    l.price_range.mostRelevantComps.slice(0, 3).forEach((c) => console.log(`    $${c.price}  ${c.soldDate}  ${c.title}`));
  }
  if (it.flags.length) {
    console.log(`\nFlags:`);
    it.flags.forEach((f) => console.log(`  [${f.resolved ? 'resolved' : 'open'}] ${f.type}${f.detail ? ' — ' + f.detail : ''}`));
  }
  console.log(`\nSubmitted: ${l.submitted_at || 'not yet'}`);
  console.log(`\n(run "export ${id}" for copy-paste-ready listing text)`);
}

function cmdExport(store, id) {
  const it = store.getItem(id);
  if (!it) return console.error(`No item #${id}.`);
  const l = it.listing || {};
  if (!l.title) return console.error(`Item #${id} has no generated listing yet (status: ${it.status}).`);
  const content = l.content || {};
  const disclaimers = content.disclaimers || [];
  const alts = content.title_alternatives || [];
  const notes = it.attributes?.notes;

  const out = [];
  out.push(`===== GRAILED LISTING — item #${id} (review before posting) =====`, '');
  out.push('TITLE:', l.title, '');
  if (alts.length) out.push('  alt titles: ' + alts.join('  |  '), '');
  out.push('DESCRIPTION:', l.description || '', '');
  out.push(`TAGS (${(l.tags || []).length}):`, (l.tags || []).join(', '), '');
  out.push('SUGGESTED PRICE:', fmtPrice(l.price_range), '');
  if (disclaimers.length || notes) {
    out.push('--- VERIFY BEFORE POSTING ---');
    disclaimers.forEach((d) => out.push(`  • ${d}`));
    if (notes) out.push(`  • ${notes}`);
    out.push('');
  }
  out.push(`After you post it on Grailed, run:  node pipeline/drafts-cli.js submit ${id}`);
  process.stdout.write(out.join('\n') + '\n');
}

function cmdSubmit(store, id) {
  const it = store.getItem(id);
  if (!it) return console.error(`No item #${id}.`);
  store.markSubmitted(id);
  console.log(`Item #${id} marked submitted (status → submitted). Add the eventual sold price to the comps log later for §10 tracking.`);
}

function main() {
  const [cmd, idArg] = process.argv.slice(2);
  const id = idArg ? Number(idArg) : null;
  if (!cmd || !['list', 'show', 'export', 'submit'].includes(cmd)) {
    console.error('usage: node pipeline/drafts-cli.js <list | show <id> | export <id> | submit <id>>');
    process.exit(1);
  }
  if (cmd !== 'list' && !Number.isInteger(id)) {
    console.error(`"${cmd}" needs a numeric item id, e.g.  drafts-cli.js ${cmd} 1`);
    process.exit(1);
  }
  const store = openStore();
  try {
    if (cmd === 'list') cmdList(store);
    else if (cmd === 'show') cmdShow(store, id);
    else if (cmd === 'export') cmdExport(store, id);
    else if (cmd === 'submit') cmdSubmit(store, id);
  } finally {
    store.close();
  }
}

main();
