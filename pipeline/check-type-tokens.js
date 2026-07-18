#!/usr/bin/env node
/*
 * M-3 typography gate: arbitrary pixel font sizes (`text-[11px]` …) are banned
 * in ui/src — use the named fontSize tokens from ui/tailwind.config.cjs
 * (text-2xs/3xs/4xs/sm-/sm+, or the built-in scale). Keeps the micro-scale
 * from silently re-fragmenting per call site.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'ui', 'src');
const BANNED = /text-\[\d+px\]/g;

const hits = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(entry.name)) {
      const lines = fs.readFileSync(p, 'utf8').split('\n');
      lines.forEach((line, i) => {
        for (const m of line.match(BANNED) ?? []) {
          hits.push(`${path.relative(process.cwd(), p)}:${i + 1}  ${m}`);
        }
      });
    }
  }
})(ROOT);

if (hits.length) {
  console.error('Arbitrary px font sizes are banned in ui/src — use the fontSize tokens in ui/tailwind.config.cjs:');
  for (const h of hits) console.error('  ' + h);
  process.exit(1);
}
console.log('typography tokens OK — no arbitrary text-[Npx] in ui/src');
