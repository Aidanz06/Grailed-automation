#!/usr/bin/env node
/*
 * Phase 0b — LIVE verification (2026-07-19) of the two fixes, through the real
 * app path (fillListing), not probe shortcuts:
 *   - photos: 12 files (> the 9 rendered slots) via the new one-call batch
 *   - designer: "Nike x Nocta" → primary autocomplete + approved-collab menu
 * Opens a fresh /sell/new tab; NEVER submits; the draft stays open for the
 * owner to inspect and discard.
 *   node phase0Test/phase0b-collab-photos-verify.js
 */

const path = require('path');
const { fillListing } = require('../ui/autofill-driver.js');

const PHOTO_DIR = path.join(__dirname, '..', 'grailed-vision-test', 'grailed-vision-test-2');
const PHOTOS = Array.from({ length: 12 }, (_, i) =>
  path.join(PHOTO_DIR, `grailed-vision-test2-${String(i + 1).padStart(2, '0')}.jpg`)
);

(async () => {
  const res = await fillListing(
    {
      photoPaths: PHOTOS,
      title: 'DRAFT — collab/photos verify, do not publish',
      department: 'Menswear',
      category: 'Outerwear',
      designer: 'Nike x Nocta',
    },
    (p) => console.log('[progress]', JSON.stringify(p))
  );
  console.log('\nRESULT:', JSON.stringify(res, null, 2));
})().catch((e) => { console.error('VERIFY FAILED:', e.message); process.exit(1); });
