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

const { app, BrowserWindow, ipcMain, dialog, protocol, net, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { openStore } = require('../pipeline/store');

// Serve item photos to the renderer from disk without weakening webSecurity.
// URLs are tailor-photo://local/<encoded file_path>; relative paths (seeded
// items) resolve against the project root, absolute paths (batch imports) as-is.
const PROJECT_ROOT = path.join(__dirname, '..');
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
// Albums (Lightroom-style): one per import batch; Home hides items of hidden
// albums. Pure app-side organization — nothing touches Grailed.
ipcMain.handle('albums:list', () => getStore().listAlbums());
ipcMain.handle('albums:setHidden', (_e, id, hidden) => getStore().setAlbumHidden(id, hidden));
// Slice 3: regenerate listing content from (possibly user-edited) attributes.
ipcMain.handle('content:generate', (_e, attributes, instructions) =>
  generateContent(attributes, instructions ? { instructions } : {})
);
// Slice 4: recompute price/comps from (possibly user-edited) attributes via the
// guarded live-Grailed provider. Cache/rate-limit/circuit-breaker are disk-backed
// (PRD §8.1), so a per-call provider is fine — guard state persists. If the
// breaker is open, getComps throws and the message surfaces to the renderer.
ipcMain.handle('comps:recompute', async (_e, attributes) => {
  const { provider, providerName } = makeCompProvider({}, (m) => console.error(m));
  const { comps, range, cached } = await provider.getComps(attributes);
  return { comps, range, providerName, cached: !!cached };
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

ipcMain.handle('batch:process', async (e, folder) => {
  const store = getStore();
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
  progress({ stage: 'grouped', done: 0, total, label: `${total} group(s) from ${photoCount} photo(s)` });
  for (let i = 0; i < groups.length; i++) {
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
  progress({ stage: 'done', done: total, total, label: 'Import complete' });
  return {
    photoCount,
    groups: groups.length,
    drafts: processed.filter((p) => p.status === 'draft').length,
    review: processed.filter((p) => p.status === 'needs_review').length,
    processed,
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
});

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
  const run = await processItem(photoPaths, { provider, providerName, content: true, label: `[review ${itemId}]` });
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
ipcMain.handle('autofill:fill', async (e, id) => {
  const { fillListing } = require('./autofill-driver');
  // S3: stream the driver's per-field events to the renderer's live checklist.
  const wc = e.sender;
  const onProgress = (p) => {
    if (!wc.isDestroyed()) wc.send('autofill:progress', p);
  };
  const item = getStore().getItem(id);
  if (!item) throw new Error(`Item ${id} not found.`);
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
  // unidentified brand.
  const brand = (attrs.resembles_brand || '').trim();
  const designer = confirmed && brand && brand.toLowerCase() !== 'unclear' ? brand : null;
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

  return fillListing({
    title: content.title ?? listing.title ?? null,
    description: content.description ?? listing.description ?? null,
    price: listing.price_range?.median ?? null,
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
    photoPaths,
  }, onProgress);
});

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
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  stopDock();
  if (store) {
    store.close();
    store = null;
  }
});
