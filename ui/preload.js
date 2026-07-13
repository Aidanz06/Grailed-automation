/*
 * Renderer <-> main bridge (Slice 1: read-only IPC wiring).
 *
 * Exposes a minimal, read-only `window.tailor` surface backed by ipcRenderer.
 * The renderer never touches SQLite / pipeline modules or API keys directly —
 * it only invokes these channels, which the main process handles.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tailor', {
  listItems: () => ipcRenderer.invoke('items:list'),
  getItem: (id) => ipcRenderer.invoke('items:get', id),
  // Slice 2: write-back.
  saveItem: (id, edits) => ipcRenderer.invoke('items:save', id, edits),
  markSubmitted: (id) => ipcRenderer.invoke('items:markSubmitted', id),
  // Permanent delete (app DB only — never touches Grailed or photo files).
  deleteItem: (id) => ipcRenderer.invoke('items:delete', id),
  // Albums: one per import batch; hidden albums drop off the Home lists.
  listAlbums: () => ipcRenderer.invoke('albums:list'),
  setAlbumHidden: (id, hidden) => ipcRenderer.invoke('albums:setHidden', id, hidden),
  // Slice 3: regenerate content (Anthropic, runs in main).
  generateContent: (attributes, instructions) => ipcRenderer.invoke('content:generate', attributes, instructions),
  // Slice 4: recompute price/comps (guarded live Grailed, runs in main).
  recomputeComps: (attributes) => ipcRenderer.invoke('comps:recompute', attributes),
  // Open a comp's Grailed listing in the system browser (allowlisted in main).
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  // Slice 5: batch intake — folder picker + cluster/process/save.
  pickBatchFolder: () => ipcRenderer.invoke('batch:pickFolder'),
  processBatch: (folder) => ipcRenderer.invoke('batch:process', folder),
  // Batch progress stream (grouping → per-group processing). Returns an
  // unsubscribe function for the import screen's unmount cleanup.
  onBatchProgress: (cb) => {
    const listener = (_e, p) => cb(p);
    ipcRenderer.on('batch:progress', listener);
    return () => ipcRenderer.removeListener('batch:progress', listener);
  },
  // Review-queue resolution (§5.1): confirm / split / reassign flagged groups.
  reviewConfirm: (id) => ipcRenderer.invoke('review:confirm', id),
  reviewSplit: (id, photoIds) => ipcRenderer.invoke('review:split', id, photoIds),
  reviewAssign: (id, photoIds, targetId) => ipcRenderer.invoke('review:assign', id, photoIds, targetId),
  // Slice 6: autofill the sell form in the driven real Chrome (never submits).
  // opts.changedOnly = re-fill only the fields edited since the last fill.
  fillListing: (id, opts) => ipcRenderer.invoke('autofill:fill', id, opts),
  // What a re-fill would change (diff vs the last-fill snapshot). Read-only.
  getFillChanges: (id) => ipcRenderer.invoke('autofill:changes', id),
  // S3: per-field fill progress (plan + filling/ok/failed/skipped per field).
  // Returns an unsubscribe function for the editor's unmount cleanup.
  onFillProgress: (cb) => {
    const listener = (_e, p) => cb(p);
    ipcRenderer.on('autofill:progress', listener);
    return () => ipcRenderer.removeListener('autofill:progress', listener);
  },
  getAutofillOptions: () => ipcRenderer.invoke('autofill:options'),
  getGuardStatus: () => ipcRenderer.invoke('guard:status'),
  // Read-only preflight: are the build's keys configured? Booleans only —
  // key values never reach the renderer.
  getConfigStatus: () => ipcRenderer.invoke('config:status'),
  // Read-only Chrome tab probe (HTTP /json/list only — no page connection):
  // drives the header status chip + the fresh-Sell-form fill gate.
  getChromeStatus: () => ipcRenderer.invoke('chrome:status'),
  // Launch the dedicated CDP Chrome from the app (spawn in main; no-op if a
  // connected Chrome is already up). Sign-in stays manual in that window.
  launchChrome: () => ipcRenderer.invoke('chrome:launch'),
  // Open a fresh Sell-form tab in the launched Chrome (new tab only).
  openSellTab: () => ipcRenderer.invoke('chrome:openSellTab'),
  // §5.5 window docking: snap the real Chrome window against the app window.
  // onDockStopped returns an unsubscribe function (fires if Chrome quits).
  startDock: () => ipcRenderer.invoke('dock:start'),
  stopDock: () => ipcRenderer.invoke('dock:stop'),
  onDockStopped: (cb) => {
    const listener = (_e, info) => cb(info);
    ipcRenderer.on('dock:stopped', listener);
    return () => ipcRenderer.removeListener('dock:stopped', listener);
  },
});
