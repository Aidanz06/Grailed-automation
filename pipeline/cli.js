#!/usr/bin/env node
/*
 * Pipeline test CLI (PRD §5.3 end-to-end): photos in → attributes + comps + price range out.
 *
 *   node pipeline/cli.js <photo1> [photo2 ...] [flags]
 *
 * Flags:
 *   --mock            Use MockCompProvider (synthetic comps) instead of live Grailed scrape.
 *   --comps=grailed   Force the Grailed scrape provider (default; needs GRAILED_ALGOLIA_KEY).
 *   --model=<id>      Override the vision model (default claude-opus-4-8 / $ATTRIBUTE_MODEL).
 *   -h, --help        Show this help.
 *
 * Env:
 *   ANTHROPIC_API_KEY    required (vision call)
 *   GRAILED_ALGOLIA_KEY  required for live comps (see priceProvider.js for how to obtain)
 *
 * stdout = JSON result only. Warnings/errors go to stderr, so you can pipe stdout to jq.
 *
 * Standalone: imports nothing from phase0b.js or any CDP/browser code.
 */

const { processItem } = require('./processItem');
const { openStore, DEFAULT_DB } = require('./store');

function parseArgs(argv) {
  const photos = [];
  const opts = { mock: false, comps: 'grailed', model: undefined, help: false, content: true, note: undefined, save: false };
  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg === '--mock') opts.mock = true;
    else if (arg === '--no-content') opts.content = false;
    else if (arg === '--save') opts.save = true;
    else if (arg.startsWith('--note=')) opts.note = arg.slice('--note='.length);
    else if (arg.startsWith('--comps=')) opts.comps = arg.slice('--comps='.length);
    else if (arg.startsWith('--model=')) opts.model = arg.slice('--model='.length);
    else if (arg.startsWith('--')) {
      console.error(`Unknown flag: ${arg}`);
      opts.help = true;
    } else photos.push(arg);
  }
  return { photos, opts };
}

const HELP = `Grailed pipeline test CLI

Usage:
  node pipeline/cli.js <photo1.jpg> [photo2.png ...] [flags]

Flags:
  --mock          Synthetic comps instead of the live Grailed scrape.
  --no-content    Skip listing-content generation (§5.2).
  --note=<text>   Steer content generation / regeneration (e.g. --note="punchier title").
  --comps=grailed Force the Grailed comp provider (default; cached + rate-limited).
  --model=<id>    Override the model for vision + content.
  --save          Persist the run to the local SQLite store (data/resale-studio.db).

All photos are treated as ONE item. Prints {attributes, content, range, comps} as JSON.

Env: ANTHROPIC_API_KEY (required), GRAILED_ALGOLIA_KEY (required unless --mock).`;

async function main() {
  const { photos, opts } = parseArgs(process.argv.slice(2));

  if (opts.help || photos.length === 0) {
    console.error(HELP);
    process.exit(opts.help ? 0 : 1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ERROR: ANTHROPIC_API_KEY is not set (needed for the vision call).');
    process.exit(1);
  }

  const item = await processItem(photos, {
    model: opts.model,
    mock: opts.mock,
    comps: opts.comps,
    content: opts.content,
    note: opts.note,
  });

  const result = { generatedAt: new Date().toISOString(), ...item };

  if (opts.save) {
    try {
      const store = openStore();
      const itemId = store.saveItemRun(item);
      store.close();
      result.savedItemId = itemId;
      console.error(`[saved] item #${itemId} → ${DEFAULT_DB}`);
    } catch (err) {
      console.error(`[warn] save failed: ${err.message}`);
    }
  }

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

main().catch((err) => {
  console.error('pipeline error:', err && err.message ? err.message : err);
  process.exit(1);
});
