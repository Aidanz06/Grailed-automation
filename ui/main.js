/*
 * Tailor Studio — Electron main process (PRD §5.4 sidebar UI + §5.5 autofill
 * and live view).
 *
 * IPC handlers back the React renderer: store reads/writes, content
 * generation, guarded comps, batch intake, Grailed autofill via the CDP
 * driver, and §5.5 window docking (snaps the real Chrome window against the
 * app). Keys and pipeline/ modules live here only, never in the renderer.
 *
 * Run:  npm run ui   (or: electron ui/main.js)
 */

const { app, BrowserWindow, Menu, ipcMain, dialog, protocol, net, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { openStore } = require('../pipeline/store');

// Serve item photos to the renderer from disk without weakening webSecurity.
// URLs are tailor-photo://local/<encoded file_path>; relative paths (seeded
// items) resolve against the project root, absolute paths (batch imports) as-is.
const PROJECT_ROOT = path.join(__dirname, '..');
// The macOS app menu takes its name from the process — without this a dev run
// (`npm run ui`) shows "Electron" in the menu bar (UX audit #11).
app.name = 'Tailor Studio';
protocol.registerSchemesAsPrivileged([
  { scheme: 'tailor-photo', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// Load .env.local (shell `export KEY=value` format) into process.env so the
// main process has ANTHROPIC_API_KEY for content generation (Slice 3). Keys stay
// in the main process only — never exposed to the renderer. Shell-provided env
// wins (don't override an already-set var).
function loadEnvLocal() {
  let text;
  try {
    text = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const key = m[1];
    const val = m[2].replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnvLocal();

const { generateContent } = require('../pipeline/content');
const { processItem, makeCompProvider } = require('../pipeline/processItem');
const { getCompsTiered } = require('../pipeline/priceProvider');
const { groupBatch } = require('../pipeline/cluster');

// Slice 1: read-only IPC into the local SQLite store. Opened once, reused for
// the app's lifetime. pipeline/store.js is imported, never modified.
let store = null;
function getStore() {
  if (!store) store = openStore();
  return store;
}

ipcMain.handle('items:list', () => getStore().listItems());
ipcMain.handle('items:get', (_e, id) => getStore().getItem(id));
// Slice 2: persist review-sidebar edits + "mark submitted" back to the store.
ipcMain.handle('items:save', (_e, id, edits) => {
  getStore().saveItemEdits(id, edits);
  return true;
});
ipcMain.handle('items:markSubmitted', (_e, id) => {
  getStore().markSubmitted(id);
  return true;
});
// Permanent delete (Home screen, mainly for testing): removes the item + all
// attached rows from the app's DB. Never touches Grailed or the photo files.
ipcMain.handle('items:delete', (_e, id) => getStore().deleteItem(id));
// §E8 "Duplicate / list another like this": clone a draft's attributes +
// text as a NEW draft with its identity reset — no photos (the similar
// garment gets its own shoot), no fill snapshot, no flags, and no Smart
// Pricing opt-in (that's a per-item decision, never inherited). Comps/range
// copy over as a starting point; Recompute re-derives them if the new item
// differs.
ipcMain.handle('items:duplicate', (_e, id) => {
  const store = getStore();
  const src = store.getItem(id);
  if (!src) throw new Error(`Item ${id} not found.`);
  if (!src.listing?.content) throw new Error('Only drafts with a generated listing can be duplicated.');
  const attrs = src.attributes ? { ...src.attributes } : null;
  if (attrs) {
    delete attrs.smart_pricing_enabled;
    delete attrs.smart_pricing_floor;
  }
  const itemId = store.saveItemRun({
    photos: [],
    attributes: attrs,
    content: JSON.parse(JSON.stringify(src.listing.content)),
    range: src.listing.price_range ?? null,
    comps: (src.comps || []).map((c) => ({ source: c.source, price: c.sold_price, soldDate: c.sold_date, url: c.url })),
    flags: [],
    status: 'draft',
    albumId: src.album_id ?? null,
  });
  return { itemId };
});
// Albums (Lightroom-style): one per import batch; Home hides items of hidden
// albums. Pure app-side organization — nothing touches Grailed.
ipcMain.handle('albums:list', () => getStore().listAlbums());
ipcMain.handle('albums:setHidden', (_e, id, hidden) => getStore().setAlbumHidden(id, hidden));
// App settings (plan §A): plain key/value in the SQLite store so the PIPELINE
// can read them too (description styles must reach generation at import and
// on Regenerate). Generic get/set — the renderer owns which keys exist.
ipcMain.handle('settings:get', (_e, key) => getStore().getSetting(String(key)));
ipcMain.handle('settings:set', (_e, key, value) => getStore().setSetting(String(key), value));

// Description Styles Phase 1 (docs/DESIGN-description-styles.md): the stored
// description is COMPOSED from the active style template — constants (footer,
// labels) come from code, data chips from attributes, prose chips from the
// AI's desc_parts. Applied at all three generation sites so the store always
// holds the finalized body (the fill payload + copy paths then only need the
// footer backstop). Key duplicated in ui/src/lib/api.ts.
const { activeTemplate, chipValues, composeDescription, finalizeDescription } = require('../pipeline/descriptionTemplate');
const DESCRIPTION_STYLES_KEY = 'descriptionStyles';
function descriptionStylesRaw() {
  try {
    return getStore().getSetting(DESCRIPTION_STYLES_KEY) || null;
  } catch {
    return null; // settings must never block generation
  }
}
function composeItemDescription(content, attributes) {
  try {
    if (!content) return content;
    const t = activeTemplate(descriptionStylesRaw());
    const body = composeDescription(t, chipValues(attributes, content.desc_parts));
    // No usable parts (legacy shape, refusal edge) → keep the AI body, but the
    // constant footer still lands — that is the whole point of the feature.
    content.description = finalizeDescription(body || String(content.description || '').trim(), t);
  } catch (err) {
    console.error('[styles] compose failed, keeping raw description:', err);
  }
  return content;
}

// Saved defaults: the seller's always-on tags (comma-separated setting, twin
// key in ui/src/lib/api.ts) merged into every NEWLY generated draft's tags —
// generated tags first, deduped case-insensitively, capped at 10 (the
// generation schema's own limit). Applied at all three generation sites
// (batch import, review-confirm, Regenerate); never blocks generation.
const DEFAULT_TAGS_KEY = 'defaultTags';
function applyDefaultTags(content) {
  try {
    if (!content || !Array.isArray(content.tags)) return content;
    const raw = getStore().getSetting(DEFAULT_TAGS_KEY) || '';
    const extra = raw.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (!extra.length) return content;
    const seen = new Set(content.tags.map((t) => String(t).toLowerCase()));
    for (const t of extra) {
      if (!seen.has(t)) {
        content.tags.push(t);
        seen.add(t);
      }
    }
    content.tags = content.tags.slice(0, 10);
  } catch {
    /* settings must never block generation */
  }
  return content;
}

// Slice 3: regenerate listing content from (possibly user-edited) attributes.
ipcMain.handle('content:generate', async (_e, attributes, instructions) =>
  composeItemDescription(
    applyDefaultTags(await generateContent(attributes, instructions ? { instructions } : {})),
    attributes
  )
);
// Slice 4: recompute price/comps from (possibly user-edited) attributes via the
// guarded live-Grailed provider. Cache/rate-limit/circuit-breaker are disk-backed
// (PRD §8.1), so a per-call provider is fine — guard state persists. If the
// breaker is open, getComps throws and the message surfaces to the renderer.
ipcMain.handle('comps:recompute', async (_e, attributes) => {
  const { provider, providerName } = makeCompProvider({}, (m) => console.error(m));
  // Narrow-first (§B): target an identical sale before broadening — the same
  // tiered path import uses, through the same guard.
  const { comps, range, cached, tier } = await getCompsTiered(provider, attributes);
  return { comps, range, providerName, cached: !!cached, tier };
});

// Open a comp's listing in the system default browser. Allowlisted to Grailed
// so the renderer can't use this as an arbitrary-URL launcher.
ipcMain.handle('open:external', async (_e, url) => {
  let u;
  try { u = new URL(String(url)); } catch { throw new Error(`Not a valid URL: ${url}`); }
  if (u.protocol !== 'https:' || !/(^|\.)grailed\.com$/.test(u.hostname)) {
    throw new Error(`Refusing to open non-Grailed URL: ${url}`);
  }
  await shell.openExternal(u.toString());
  return { ok: true };
});

// Slice 5: batch intake (PRD §5.1). Pick a folder, cluster its photos, run the
// full pipeline on auto-accept groups and save them as drafts; flagged groups
// are saved unprocessed as 'needs_review' for manual handling. Mirrors
// batch-cli.js --run: one shared comp provider spans the batch (§8.1). The app
// never submits — output is editable drafts.
ipcMain.handle('batch:pickFolder', async () => {
  const res = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), {
    title: 'Choose a photo folder',
    properties: ['openDirectory'],
  });
  return res.canceled || !res.filePaths.length ? null : res.filePaths[0];
});

// Real "add photo" (UX audit #1): native image picker → append the picked
// files to the item's photos in the store. Local paths only — nothing goes to
// Grailed until the user triggers Fill listing. Canceled dialog → null.
ipcMain.handle('photos:add', async (_e, itemId) => {
  const res = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), {
    title: 'Add photos',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'heic'] }],
  });
  if (res.canceled || !res.filePaths.length) return null;
  return getStore().addPhotos(itemId, res.filePaths);
});

// UX audit #4: cancel for the two long-running jobs. One import and one fill
// run at a time (the renderer gates both), so module-level flags suffice —
// the handlers check them at their natural boundaries (between groups /
// between fields; the single in-flight vision call is not interruptible, so
// cancel takes effect at the next boundary). Mirrors updater.js's
// cancelRequested flag + its too-late guard style. Busy flags double as the
// quit guard's signal (audit #5).
let batchRunning = false;
let batchCancelRequested = false;
let fillRunning = false;
let fillCancelRequested = false;
ipcMain.handle('batch:cancel', () => {
  if (!batchRunning) return { ok: false, message: 'No import is running.' };
  batchCancelRequested = true;
  return { ok: true };
});
ipcMain.handle('autofill:cancel', () => {
  if (!fillRunning) return { ok: false, message: 'No fill is running.' };
  fillCancelRequested = true;
  return { ok: true };
});

ipcMain.handle('batch:process', async (e, folder) => {
  const store = getStore();
  batchRunning = true;
  batchCancelRequested = false;
  try {
    return await runBatchProcess(e, folder, store);
  } finally {
    batchRunning = false;
  }
});

async function runBatchProcess(e, folder, store) {
  // Live progress for the renderer (integration plan P1.4): grouping is one
  // ~25s call, then each auto-accepted group runs the full per-item pipeline
  // (attributes → comps → content). Stream stage/counts instead of a frozen
  // spinner; the renderer unsubscribes when the import screen unmounts.
  const wc = e.sender;
  const progress = (p) => {
    if (!wc.isDestroyed()) wc.send('batch:progress', p);
  };

  progress({ stage: 'grouping', done: 0, total: 0, label: 'Scanning folder…' });
  // groupBatch has its own internal fallback (batched-vision → descriptor-
  // improved); this try/catch is the last line — both strategies failing
  // surfaces as ONE clean error the UI toasts, not an unhandled rejection.
  let grouped;
  try {
    grouped = await groupBatch(folder, {
      log: (m) => console.error(m),
      // Fine-grained stages from inside the strategies: photo prep and
      // per-photo describe have real denominators; the batched vision call
      // itself is one opaque request (~20s) with none.
      onProgress: (p) => {
        if (p.phase === 'prepare')
          progress({ stage: 'preparing', done: p.done, total: p.total, label: `Preparing photo ${p.done}/${p.total}…` });
        else if (p.phase === 'analyze')
          progress({ stage: 'analyzing', done: 0, total: 0, label: 'AI grouping — all photos in one pass (~20–30s)…' });
        else if (p.phase === 'describe')
          progress({ stage: 'describing', done: p.done, total: p.total, label: `Analyzing photo ${p.done}/${p.total}…` });
        else if (p.phase === 'fallback')
          progress({ stage: 'grouping', done: 0, total: 0, label: `Primary grouping failed — retrying per photo with ${p.to}…` });
      },
    });
  } catch (err) {
    progress({ stage: 'error', done: 0, total: 0, label: String(err.message || err) });
    throw new Error(`Photo grouping failed — nothing was imported. ${err.message}`);
  }
  const { photoCount, groups, meta } = grouped;
  // Stopped during the grouping call: nothing has been saved yet — say so and
  // stop before creating an album or touching the pipeline.
  if (batchCancelRequested) {
    progress({ stage: 'done', done: 0, total: groups.length, label: 'Import stopped — nothing was saved yet' });
    return { photoCount, groups: groups.length, drafts: 0, review: 0, processed: [], cancelled: true };
  }
  // §5.6 telemetry: record what the grouping did (strategy, fallback, per-group
  // confidence/flags) so later corrections have a baseline to compare against.
  try {
    store.logGroupingEvent({ folder, strategy: meta?.strategy ?? null, fallbackFrom: meta?.fallbackFrom ?? null, meta, groups });
  } catch (err) {
    console.error('[batch] telemetry write failed (non-fatal):', err.message);
  }

  // Album per import (Lightroom-style): every item this batch saves belongs to
  // it, so the whole batch can later be hidden from Home in one click.
  let albumId = null;
  try {
    const day = new Date().toISOString().slice(0, 10);
    albumId = store.createAlbum({ folder, name: `${path.basename(folder)} — ${day}` });
  } catch (err) {
    console.error('[batch] album create failed (items land in "Earlier items"):', err.message);
  }

  const shared = makeCompProvider({}, (m) => console.error(m));
  const processed = [];
  const total = groups.length;
  let cancelled = false;
  progress({ stage: 'grouped', done: 0, total, label: `${total} group(s) from ${photoCount} photo(s)` });
  for (let i = 0; i < groups.length; i++) {
    // Cancel boundary (audit #4): between groups — whatever already saved
    // stays saved; the remaining groups are simply never started.
    if (batchCancelRequested) {
      cancelled = true;
      break;
    }
    const g = groups[i];
    const base = {
      photos: g.photos.map((p) => ({ file_path: p, cluster_confidence: g.confidence })),
      flags: g.flags,
      albumId,
    };
    // Announce each saved item as it lands (stream-drafts UX): the renderer
    // refreshes the sidebar incrementally and offers "start editing" before
    // the rest of the batch finishes.
    const announce = (entry, label) =>
      progress({ stage: 'processing', done: i + 1, total, label, item: entry });
    if (g.autoAccept) {
      progress({ stage: 'processing', done: i, total, label: `Pricing + writing group ${i + 1}/${total}…` });
      try {
        const item = await processItem(g.photos, {
          provider: shared.provider,
          providerName: shared.providerName,
          content: true,
          label: `[group ${g.groupId}]`,
        });
        applyDefaultTags(item.content); // saved defaults: the seller's always-on tags
        composeItemDescription(item.content, item.attributes); // active style template + footer
        // base last so confidence-annotated photos + flags win over plain paths.
        const id = store.saveItemRun({ ...item, ...base, status: 'draft' });
        const entry = { groupId: g.groupId, itemId: id, status: 'draft', title: item.content?.title ?? null };
        processed.push(entry);
        announce(entry, `Draft ready: ${entry.title ?? `group ${g.groupId}`} (${i + 1}/${total})`);
      } catch (err) {
        // One group failing (API 413, comps outage, refusal…) must not abort
        // the whole import and orphan the remaining groups. Park it in Review
        // with the real error so the user can retry from there.
        console.error(`[batch] group ${g.groupId} pricing/writing failed:`, err);
        const failFlag = {
          type: 'processing_failed',
          detail: `Pricing/writing failed: ${String(err.message || err)} — resolve in Review to retry.`,
        };
        const id = store.saveItemRun({ ...base, flags: [...(g.flags || []), failFlag], status: 'needs_review' });
        const entry = {
          groupId: g.groupId, itemId: id, status: 'needs_review', signature: g.signature,
          flags: g.flags, error: String(err.message || err),
        };
        processed.push(entry);
        announce(entry, `Group ${i + 1}/${total} parked in Review (error)`);
      }
    } else {
      progress({ stage: 'processing', done: i, total, label: `Saving group ${i + 1}/${total} for review…` });
      const id = store.saveItemRun({ ...base, status: 'needs_review' });
      const entry = { groupId: g.groupId, itemId: id, status: 'needs_review', signature: g.signature, flags: g.flags };
      processed.push(entry);
      announce(entry, `Group ${i + 1}/${total} saved for review`);
    }
  }
  const draftCount = processed.filter((p) => p.status === 'draft').length;
  progress({
    stage: 'done',
    done: processed.length,
    total,
    label: cancelled
      ? `Import stopped — ${draftCount} draft(s) already saved; nothing was posted to Grailed`
      : 'Import complete',
  });
  return {
    photoCount,
    groups: groups.length,
    drafts: draftCount,
    review: processed.filter((p) => p.status === 'needs_review').length,
    processed,
    cancelled: cancelled || undefined,
    // Non-fatal notice when the primary strategy failed and the fallback ran.
    groupingNotice: meta?.fallbackFrom
      ? `Grouping fell back to ${meta.strategy} (${meta.fallbackFrom} failed: ${meta.fallbackReason}).`
      : undefined,
    // Non-fatal notice when some groups errored during pricing/writing.
    processingNotice: (() => {
      const failed = processed.filter((p) => p.error).length;
      return failed ? `${failed} group(s) hit an error while pricing/writing and were parked in Review.` : undefined;
    })(),
  };
}

// Review-queue resolution (§5.1 / UX review S1): confirm, split, reassign —
// the actions that let a flagged group LEAVE the review queue. Each records a
// correction event (§5.6 telemetry: user fixes are ground truth for tuning).
// Nothing here touches Grailed.

// "These photos are one item" → run the full pipeline on them and turn this
// review item into a draft in place.
ipcMain.handle('review:confirm', async (_e, itemId) => {
  const store = getStore();
  const item = store.getItem(itemId);
  if (!item) throw new Error(`Item ${itemId} not found.`);
  if (!item.photos.length) throw new Error('This group has no photos.');
  const photoPaths = item.photos.map((p) =>
    path.isAbsolute(p.file_path) ? p.file_path : path.join(PROJECT_ROOT, p.file_path)
  );
  const { provider, providerName } = makeCompProvider({}, (m) => console.error(m));
  const run = await processItem(photoPaths, {
    provider,
    providerName,
    content: true,
    label: `[review ${itemId}]`,
  });
  applyDefaultTags(run.content); // saved defaults: the seller's always-on tags
  composeItemDescription(run.content, run.attributes); // active style template + footer
  store.updateItemRun(itemId, { attributes: run.attributes, content: run.content, range: run.range, comps: run.comps });
  store.logCorrection('confirm', { itemId, photos: item.photos.length });
  return { itemId, title: run.content?.title ?? null };
});

// Move the selected photos out into a fresh review item (split), or into an
// existing item (reassign). The source item is deleted if it ends up empty.
ipcMain.handle('review:split', (_e, itemId, photoIds) => {
  const store = getStore();
  if (!photoIds?.length) throw new Error('Select at least one photo to split out.');
  const newItemId = store.createReviewItem(`split from item #${itemId}`);
  store.movePhotos(photoIds, newItemId);
  const sourceDeleted = store.deleteItemIfEmpty(itemId);
  store.logCorrection('split', { itemId, newItemId, photos: photoIds.length, sourceDeleted });
  return { newItemId, sourceDeleted };
});

ipcMain.handle('review:assign', (_e, itemId, photoIds, targetItemId) => {
  const store = getStore();
  if (!photoIds?.length) throw new Error('Select at least one photo to assign.');
  if (targetItemId === itemId) throw new Error('Target is the same item.');
  if (!store.getItem(targetItemId)) throw new Error(`Target item ${targetItemId} not found.`);
  store.movePhotos(photoIds, targetItemId);
  const sourceDeleted = store.deleteItemIfEmpty(itemId);
  store.logCorrection('assign', { itemId, targetItemId, photos: photoIds.length, sourceDeleted });
  return { targetItemId, sourceDeleted };
});

// Slice 6: autofill the Grailed sell form in the separately-launched real
// Chrome (PRD §5.5, techniques proven in Phase 0b). Maps the stored item onto
// the v1 field set — title/description/price/condition + photos; category/
// size/designer stay manual (grailed-selectors.json _dependentFieldsPolicy).
// The driver refuses when the §8.1 breaker is open and NEVER submits.
/*
 * Map a stored item onto the driver's fill payload. Shared by the fill itself
 * and the changes-since-last-fill diff so the two can never disagree.
 * Returns { fields, photoPaths }: `fields` are the app-level values the
 * driver receives (also what the last-fill snapshot stores). Photos ride
 * separately — they're filled but never diffed/re-filled (see below).
 */
// First segment of a collab brand string — split ONLY on "x"/"×" with
// whitespace around it, so "Dolce & Gabbana" and hyphenated brands survive.
function primaryBrand(raw) {
  return String(raw || '').split(/\s+[x×]\s+/i)[0].trim();
}

// Twin of ui/src/lib/grailedColor.ts mapGrailedColor (vitest covers the
// logic there) — free-text primary_color → Grailed's fixed color option.
// Needed here as the FILL-TIME fallback: the DraftForm adoption effect only
// runs when the editor is opened, so items filled straight from the triage
// queue shipped without a color (found live 2026-07-19; "grey" also never
// matched "Gray" before the synonym fold). Keep the twins in sync.
const GRAILED_COLOR_SYNONYMS = {
  grey: 'Gray', charcoal: 'Gray', navy: 'Blue', cream: 'Beige',
  'off-white': 'White', 'off white': 'White', ivory: 'White',
  tan: 'Beige', khaki: 'Beige', olive: 'Green', burgundy: 'Red',
  maroon: 'Red', multicolor: 'Multi', 'multi-color': 'Multi',
  multicolour: 'Multi', multicolored: 'Multi',
};
function mapGrailedColor(primary, options) {
  const pc = String(primary || '').trim().toLowerCase();
  if (!pc || !options.length) return null;
  const exact = options.find((c) => c.toLowerCase() === pc);
  if (exact) return exact;
  const syn = Object.entries(GRAILED_COLOR_SYNONYMS).find(([k]) => pc === k || pc.includes(k));
  if (syn) {
    const target = options.find((c) => c.toLowerCase() === syn[1].toLowerCase());
    if (target) return target;
  }
  return options.find((c) => pc.includes(c.toLowerCase()) || c.toLowerCase().includes(pc)) ?? null;
}

/*
 * Fill-time adoption of color/style (the DraftForm effect's persistent twin):
 * when the item still has no grailed_color/grailed_style but the AI attributes
 * carry a mappable primary_color / grailed_style_estimate, adopt them into the
 * stored attributes BEFORE the payload is built — so triage-queue fills that
 * never opened the editor still fill color, and the editor shows exactly what
 * the fill sent. Conservative: only fills blanks, never overrides a value the
 * user (or a previous adoption) set.
 */
function adoptFillDefaults(store, item) {
  const attrs = item.attributes || {};
  let sel;
  try {
    sel = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'grailed-selectors.json'), 'utf8'));
  } catch {
    return item; // no selectors, no adoption — the fill will cope
  }
  const colors = sel.dropdowns?.color?.options || [];
  const styles = sel.dropdowns?.style?.options || [];
  const next = {};
  if (!attrs.grailed_color && attrs.primary_color) {
    const c = mapGrailedColor(attrs.primary_color, colors);
    if (c) next.grailed_color = c;
  }
  if (!attrs.grailed_style && attrs.grailed_style_estimate) {
    const est = String(attrs.grailed_style_estimate).trim().toLowerCase();
    const s = styles.find((o) => o.toLowerCase() === est);
    if (s) next.grailed_style = s;
  }
  if (!Object.keys(next).length) return item;
  try {
    store.saveItemEdits(item.id, { attributes: { ...attrs, ...next } });
    return store.getItem(item.id);
  } catch (err) {
    console.error('[autofill] color/style adoption failed (fill continues without):', err.message);
    return item;
  }
}

function buildFillPayload(item) {
  const listing = item.listing || {};
  const content = listing.content || {};
  // Same path resolution as the tailor-photo:// protocol: seeded items store
  // project-relative paths, batch imports absolute ones.
  const photoPaths = (item.photos || []).map((p) =>
    path.isAbsolute(p.file_path) ? p.file_path : path.join(PROJECT_ROOT, p.file_path)
  );
  // A1 staged confirmation: grailed_department/grailed_category exist ONLY
  // after the user confirms the suggested category in DraftEditor — that
  // confirmation is the gate for the whole dependent cascade (category →
  // size/sub-category/designer). Unconfirmed = all four stay manual.
  const attrs = item.attributes || {};
  const confirmed = !!(attrs.grailed_department && attrs.grailed_category);
  let size = confirmed ? attrs.size || null : null;
  // Grailed bottoms sizes are waist digits ("US 32 /…") — "32x30" won't match.
  if (size && attrs.grailed_category === 'Bottoms') size = (size.match(/^\d{2}/) || [size])[0];
  // Designer comes from the (user-editable) brand attribute; never fill an
  // unidentified brand. The driver now handles collabs itself (probed live
  // 2026-07-19): it types the PRIMARY brand into the autocomplete, then picks
  // the partner from Grailed's approved-collaborations menu — so send the
  // FULL collab string. New extractions split the partner into
  // attrs.collaboration (join it back); older/hand-typed items may carry the
  // collab inline in resembles_brand already. Twin helper in ui/src/lib/utils.ts.
  const brandRaw = String(attrs.resembles_brand || '').trim();
  const partner = String(attrs.collaboration || '').trim();
  const fullBrand = partner && !/\s+[x×]\s+/i.test(brandRaw) ? `${brandRaw} x ${partner}` : brandRaw;
  const primary = primaryBrand(brandRaw);
  const designer = confirmed && primary && primary.toLowerCase() !== 'unclear' ? fullBrand : null;
  // The pipeline's subcategory is free text ("graphic t-shirt"); Grailed's
  // options are fixed labels ("Short Sleeve T-Shirts"). Translate via the
  // per-category appValueRules in grailed-selectors.json (first regex wins);
  // unmatched values pass through raw and the driver reports what WAS available.
  let subcategory = confirmed ? attrs.subcategory || null : null;
  if (subcategory) {
    try {
      const selJson = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'grailed-selectors.json'), 'utf8'));
      const rules = selJson.dropdowns?.subcategory?.appValueRules?.[attrs.grailed_category] || [];
      for (const [re, option] of rules) {
        if (new RegExp(re, 'i').test(subcategory)) {
          subcategory = option;
          break;
        }
      }
    } catch (err) {
      console.error('[autofill] subcategory rule mapping failed (raw value used):', err.message);
    }
  }

  // Smart Pricing (plan §I): opt-in ONLY. The `smartPricing` field IS the
  // floor value, and non-null is the whole signal the driver acts on — it
  // exists only when the user enabled the per-item toggle (default OFF) AND
  // set a numeric floor. Anything else stays null and the driver never touches
  // Grailed's Smart Pricing section. Field name matches the driver's step/
  // results key so the last-fill snapshot + changed-only diff work unchanged.
  const spFloorDigits =
    attrs.smart_pricing_enabled && attrs.smart_pricing_floor != null
      ? String(attrs.smart_pricing_floor).replace(/[^0-9]/g, '')
      : '';

  // Footer backstop (Description Styles): whatever reaches Grailed carries the
  // active style's constant footer as its exact last line — even for legacy
  // drafts stored before composition existed. finalizeDescription is idempotent.
  const rawDesc = content.description ?? listing.description ?? null;
  let filledDesc = rawDesc;
  if (rawDesc != null) {
    try {
      const t = activeTemplate(descriptionStylesRaw());
      filledDesc = finalizeDescription(rawDesc, t);
    } catch {
      /* never block a fill on styles */
    }
  }

  return {
    fields: {
      title: content.title ?? listing.title ?? null,
      description: filledDesc,
      price: listing.price_range?.median ?? null,
      smartPricing: spFloorDigits ? Number(spFloorDigits) : null,
      condition: attrs.condition_rating || null,
      // User-selected Grailed details (optional attributes_json fields):
      color: attrs.grailed_color || null,
      style: attrs.grailed_style || null,
      countryOfOrigin: attrs.country_of_origin || null,
      department: confirmed ? attrs.grailed_department : null,
      category: confirmed ? attrs.grailed_category : null,
      size,
      subcategory,
      designer,
    },
    photoPaths,
  };
}

/*
 * Diff the would-be payload against the item's last-fill snapshot.
 * Returns [{ field, from, to }]. Photos are deliberately NOT diffed or
 * reported (owner decision 2026-07-06): photo changes are handled directly on
 * the Grailed form — re-running the upload would only ADD duplicates.
 */
function diffAgainstLastFill(payload, lastFill) {
  const prev = lastFill?.fields || {};
  const changes = [];
  for (const [field, to] of Object.entries(payload.fields)) {
    const from = prev[field] ?? null;
    if (String(from ?? '') !== String(to ?? '')) changes.push({ field, from, to });
  }
  return changes;
}

// Changes since the last fill (renderer's "what will a re-fill do" card).
// Read-only: builds the same payload the fill would and diffs it.
ipcMain.handle('autofill:changes', (_e, id) => {
  const item = getStore().getItem(id);
  if (!item) throw new Error(`Item ${id} not found.`);
  const lastFill = item.last_fill || null;
  return {
    lastFillAt: lastFill?.at ?? null,
    changes: lastFill ? diffAgainstLastFill(buildFillPayload(item), lastFill) : [],
  };
});

ipcMain.handle('autofill:fill', async (e, id, opts = {}) => {
  fillRunning = true;
  fillCancelRequested = false;
  try {
    return await runAutofill(e, id, opts);
  } finally {
    fillRunning = false;
  }
});

async function runAutofill(e, id, opts) {
  const { fillListing } = require('./autofill-driver');
  // S3: stream the driver's per-field events to the renderer's live checklist.
  const wc = e.sender;
  const onProgress = (p) => {
    if (!wc.isDestroyed()) wc.send('autofill:progress', p);
  };
  const store = getStore();
  let item = store.getItem(id);
  if (!item) throw new Error(`Item ${id} not found.`);
  // Fill-time color/style adoption (see adoptFillDefaults) — items filled
  // straight from the triage queue never ran the editor's adoption effect.
  item = adoptFillDefaults(store, item);
  const payload = buildFillPayload(item);
  const lastFill = item.last_fill || null;

  // Change-aware re-fill: only the fields edited since the last fill are sent
  // (the same Sell form is assumed still open with the earlier values in it).
  // Photos are NEVER re-sent in this mode — the driver's upload appends, so a
  // reorder/delete must be mirrored by hand in Chrome (reported as `manual`).
  let fields = { ...payload.fields };
  let photoPaths = payload.photoPaths;
  if (opts.changedOnly && lastFill) {
    const changed = new Set(diffAgainstLastFill(payload, lastFill).map((c) => c.field));
    for (const k of Object.keys(fields)) if (!changed.has(k)) fields[k] = null;
    photoPaths = null;
  }

  // Cancel boundary (audit #4): the driver checks between field steps — the
  // in-flight field finishes, the rest report skipped, and the per-field
  // results stay truthful about what's already on the form.
  const result = await fillListing({ ...fields, photoPaths }, onProgress, () => fillCancelRequested);

  // Merge this run into the snapshot: a field's stored value advances only
  // when the driver reported ok, so failed/skipped fields keep showing up as
  // pending changes on the next diff.
  const snap = { at: new Date().toISOString(), fields: { ...(lastFill?.fields || {}) }, results: { ...(lastFill?.results || {}) } };
  for (const [field, r] of Object.entries(result.results || {})) {
    snap.results[field] = r;
    if (!r || r.skipped || !r.ok) continue;
    if (field in payload.fields) snap.fields[field] = payload.fields[field];
  }
  try {
    store.setLastFill(id, snap);
  } catch (err) {
    console.error('[autofill] failed to persist last-fill snapshot:', err.message);
  }
  return result;
}

// §5.5 window choreography ("dock Chrome"): make the two windows feel like
// one by snapping the REAL Chrome window flush against the app window and
// keeping it glued there as the app moves/resizes. The Chrome window is
// positioned over CDP (Browser.setWindowBounds — cross-platform, no
// macOS Accessibility / Win32 APIs needed). Strictly window management: no
// page script, no input forwarding — the user interacts and submits in the
// real Chrome. Not gated on the §8.1 breaker (it disables scraping/autofill;
// moving a window is neither).
let dock = null; // { handle, win, relayout }
async function stopDock() {
  if (!dock) return;
  const { handle, win, relayout } = dock;
  dock = null;
  if (!win.isDestroyed()) {
    win.removeListener('move', relayout);
    win.removeListener('resize', relayout);
  }
  handle.close();
}

ipcMain.handle('dock:start', async (e) => {
  if (dock) return { ok: true, alreadyActive: true };
  const { connectDock } = require('./chrome-dock');
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) throw new Error('No app window to dock against.');
  const handle = await connectDock(); // throws user-facing msgs: Chrome not up / no grailed tab
  const wc = e.sender;

  // Glue Chrome to the app's right edge. Only the INITIAL dock sizes Chrome
  // (fills from the app to the work-area edge, shrinking the app first if that
  // leaves under MIN_CHROME_W). After that the user owns Chrome's size:
  // relayout re-reads Chrome's current bounds and only repositions it, so a
  // manual Chrome resize sticks across app moves/resizes.
  const MIN_CHROME_W = 480;
  const MIN_APP_W = 900; // matches the BrowserWindow minWidth
  let timer = null;
  const relayout = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!dock || dock.handle !== handle || win.isDestroyed()) return;
      const b = win.getBounds();
      try {
        const cur = await handle.getBounds();
        await handle.setBounds({ left: b.x + b.width, top: b.y, width: cur.width, height: cur.height });
      } catch (err) {
        console.error('[dock] relayout failed', err.message);
      }
    }, 120);
  };

  dock = { handle, win, relayout };
  handle.onDisconnect(() => {
    if (dock && dock.handle === handle) {
      stopDock();
      if (!wc.isDestroyed()) wc.send('dock:stopped', { reason: 'Connection to Chrome closed — was it quit?' });
    }
  });
  win.on('move', relayout);
  win.on('resize', relayout);
  await handle.bringToFront().catch(() => {}); // make the grailed tab visible before placing it
  const b = win.getBounds();
  const wa = screen.getDisplayMatching(b).workArea;
  const right = wa.x + wa.width;
  if (right - (b.x + b.width) < MIN_CHROME_W) {
    b.width = Math.max(MIN_APP_W, right - MIN_CHROME_W - b.x);
    win.setBounds(b); // fires 'resize' → the (position-only) relayout; harmless
  }
  await handle.setBounds({
    left: b.x + b.width,
    top: b.y,
    width: Math.max(MIN_CHROME_W, right - (b.x + b.width)),
    height: b.height,
  });
  return { ok: true, targetUrl: handle.targetUrl };
});

ipcMain.handle('dock:stop', async () => {
  await stopDock(); // detaches; leaves the Chrome window where it is
  return true;
});

// Read-only Chrome status probe (audit §3.1/§3.2): one HTTP GET of
// :9222/json/list — no WebSocket, no Runtime.enable, no page script. Passive,
// so it runs regardless of the §8.1 breaker (which gates actions) and never
// trips it. Never throws: "Chrome not launched" is { connected:false }.
ipcMain.handle('chrome:status', () => {
  const { getChromeStatus } = require('./chrome-status');
  return getChromeStatus();
});

// In-app CDP Chrome launcher (extracted from phase0b.js step 1): spawns the
// real Chrome detached on :9222 with the dedicated profile; friendly no-op if
// the port is already up. Process management only — no page connection, no
// navigation of existing tabs, no auto-login (PRD §8.2), no spoofing flags
// (PRD §8.3). Not gated on the §8.1 breaker (it gates scraping/autofill;
// starting a browser the user drives is neither).
ipcMain.handle('chrome:launch', () => {
  const { launchChrome } = require('./chrome-launch');
  return launchChrome();
});

// Open a NEW tab on the Sell form in the launched Chrome (DevTools HTTP
// /json/new — creates a tab, never navigates an existing one, no page
// script). User-triggered from the status notifier / fill-blocked card when
// Chrome is connected but no Sell form is open. Sign-in stays manual.
ipcMain.handle('chrome:openSellTab', () => {
  const { openSellTab } = require('./chrome-launch');
  return openSellTab();
});

// Preflight config check (friend-beta Part E): READ-ONLY booleans about
// whether the keys this build needs are present — a keyless copy should say
// so calmly on launch instead of failing deep in the first import. The key
// VALUES never cross the IPC boundary; no other behavior, no side effects.
ipcMain.handle('config:status', () => ({
  hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
  hasCompsKey: !!process.env.GRAILED_ALGOLIA_KEY,
}));

// In-app one-click updater (tester QoL — main-process + renderer plumbing
// only; see ui/updater.js). git pull --ff-only + npm install + ui:build in
// the repo root, then relaunch. Hidden entirely when not running from a git
// clone ({ supported:false }).
const updaterMod = require('./updater');
let updating = false;
ipcMain.handle('update:check', () => updaterMod.checkForUpdate());
ipcMain.handle('update:apply', async (e, opts = {}) => {
  if (updating) return { ok: false, failedStep: null, message: 'An update is already running.', output: [] };
  // The renderer says whether an import or fill is in flight (it watches both
  // streams) — never rebuild the app under a running job.
  if (opts && opts.busy) {
    return { ok: false, failedStep: null, message: 'Finish the import or fill that’s running first, then update.', output: [] };
  }
  updating = true;
  const wc = e.sender;
  const onProgress = (p) => {
    if (!wc.isDestroyed()) wc.send('update:progress', p);
  };
  try {
    const res = await updaterMod.applyUpdate(updaterMod.REPO_ROOT, onProgress);
    if (res.ok) {
      onProgress({ step: 'restart', status: 'start', label: 'Restarting into the new version…' });
      // Let the renderer paint the final state, then relaunch into fresh dist.
      setTimeout(() => {
        app.relaunch();
        app.exit(0);
      }, 1200);
    }
    return res;
  } finally {
    updating = false;
  }
});
ipcMain.handle('update:cancel', () => updaterMod.cancelUpdate());

// §8.1 breaker state for the renderer's warning banner (polled by App.tsx).
ipcMain.handle('guard:status', () => {
  const { isCircuitOpen } = require('../pipeline/compGuard');
  return { circuitOpen: isCircuitOpen() };
});

// Grailed's color/style option lists for the renderer's detail dropdowns —
// read from grailed-selectors.json so the UI never hardcodes selectors/options.
ipcMain.handle('autofill:options', () => {
  const sel = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'grailed-selectors.json'), 'utf8'));
  // Category tree feeds the staged-confirmation picker (A1); _note is doc-only.
  const tree = {};
  for (const [dept, cats] of Object.entries(sel.dropdowns.category.tree || {})) {
    if (dept !== '_note') tree[dept] = cats;
  }
  return { colors: sel.dropdowns.color.options || [], styles: sel.dropdowns.style.options || [], categoryTree: tree };
});

/*
 * Application menu (UX audit #11): a real "Tailor Studio" menu instead of
 * Electron's defaults. Standard Edit/Window/zoom roles stay (consumers use
 * menu-level copy/paste); Reload + DevTools stay for now because the owner
 * debugs with them — they hide automatically once a packaged build exists
 * (app.isPackaged). Help opens the in-app guide via IPC.
 */
function buildAppMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }]
      : []),
    { label: 'File', submenu: [isMac ? { role: 'close' } : { role: 'quit' }] },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        ...(app.isPackaged ? [] : [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }]),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Tailor Studio Guide',
          click: () => {
            const win = BrowserWindow.getAllWindows()[0];
            if (win && !win.webContents.isDestroyed()) win.webContents.send('menu:openGuide');
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: 'Tailor Studio',
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // Standard right-click menu (UX audit #10): Electron ships none, and this
  // audience reaches for right-click before keyboard shortcuts. Editable
  // fields get Cut/Copy/Paste/Select All (enabled per Chromium's own
  // editFlags); elsewhere a text selection offers Copy. Nothing app-specific
  // yet — that layer can grow on top later.
  win.webContents.on('context-menu', (_e, params) => {
    const items = [];
    if (params.isEditable) {
      items.push(
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', enabled: params.editFlags.canSelectAll }
      );
    } else if (params.selectionText.trim()) {
      items.push({ role: 'copy' });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });

  // Renderer is now a Vite/React build. In dev, point Electron at the Vite dev
  // server (set VITE_DEV_SERVER_URL); otherwise load the built output in dist/.
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, 'dist', 'index.html'));
}

app.whenReady().then(() => {
  protocol.handle('tailor-photo', (request) => {
    try {
      // pathname is always "/" + the encoded path; strip exactly that one
      // separator slash so an absolute path keeps its own leading slash.
      const rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\//, '');
      const abs = path.isAbsolute(rel) ? rel : path.join(PROJECT_ROOT, rel);
      return net.fetch(pathToFileURL(abs).toString());
    } catch (e) {
      return new Response('bad photo request', { status: 400 });
    }
  });
  buildAppMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Quit guard (UX audit #5): Cmd+Q mid-import kills the remaining groups and
// mid-fill abandons the Chrome form half-typed — ask first. Busy state is
// tracked MAIN-side (the flags set inside the batch:process / autofill:fill
// handlers), never trusted from renderer refs. Cancel is the default button.
app.on('before-quit', (e) => {
  if (!batchRunning && !fillRunning) return;
  const what = batchRunning && fillRunning ? 'An import and a fill are' : batchRunning ? 'An import is' : 'A fill is';
  const choice = dialog.showMessageBoxSync({
    type: 'warning',
    buttons: ['Cancel', 'Quit anyway'],
    defaultId: 0,
    cancelId: 0,
    message: `${what} still running — quit anyway?`,
    detail: batchRunning
      ? 'Quitting stops the import mid-batch. Drafts already saved stay saved; nothing is posted to Grailed either way.'
      : 'Quitting abandons the half-filled Sell form in Chrome. Nothing is submitted either way.',
  });
  if (choice === 0) e.preventDefault();
});

app.on('will-quit', () => {
  stopDock();
  if (store) {
    store.close();
    store = null;
  }
});
