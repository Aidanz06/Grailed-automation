/*
 * Tailor Studio — window choreography for the driven Chrome (PRD §5.5
 * "one window" experience, docking variant).
 *
 * Positions the REAL Chrome window (the `npm run 0b:launch` instance) via the
 * CDP Browser domain on :9222 — Browser.getWindowForTarget +
 * Browser.setWindowBounds. This is a browser-level connection (not a page
 * session): no page script runs, nothing is observable from Grailed's JS, and
 * it works identically on macOS and Windows (no Accessibility API / Win32
 * SetParent needed). Chosen over an embedded view because Electron's engine is
 * a proven login block (PRD §8.2) and over screencast+input-forwarding because
 * synthetic input streams are a detection surface (§8.3/§8.5) — here the user
 * interacts with genuine Chrome, so the manual-review/submit rule holds by
 * construction.
 *
 * Bounds are in device-independent pixels, same coordinate space as
 * Electron's BrowserWindow.getBounds()/screen.workArea, so main.js can pass
 * its numbers straight through on any platform / DPI scale.
 *
 * CLI test mode (live verification without the app):
 *   node ui/chrome-dock.js snap [left top width height]
 */

const CDP = require('chrome-remote-interface');
const { getJSON, portUp, sellTarget, PORT } = require('./autofill-driver');

/*
 * Connect a browser-level CDP session and resolve the grailed tab's window.
 * Resolves to { targetUrl, setBounds(bounds), bringToFront(), getBounds(),
 * onDisconnect(cb), close() }. Throws user-facing messages (Chrome not up /
 * no grailed tab) — the IPC layer surfaces them verbatim, same as fill.
 */
async function connectDock() {
  if (!(await portUp())) {
    throw new Error(
      `Chrome CDP endpoint not found on :${PORT}. Run \`npm run 0b:launch\`, log in, and open /sell/new.`
    );
  }
  const page = await sellTarget();
  if (!page) {
    throw new Error('No grailed.com tab in the launched Chrome. Open https://www.grailed.com/sell/new there.');
  }
  const { webSocketDebuggerUrl } = await getJSON('/json/version');
  const client = await CDP({ target: webSocketDebuggerUrl });
  let windowId;
  try {
    ({ windowId } = await client.Browser.getWindowForTarget({ targetId: page.id }));
  } catch (e) {
    await client.close().catch(() => {});
    throw e;
  }

  async function setBounds({ left, top, width, height }) {
    // A maximized/fullscreen window ignores position — drop to normal first.
    const { bounds: cur } = await client.Browser.getWindowBounds({ windowId });
    if (cur.windowState && cur.windowState !== 'normal') {
      await client.Browser.setWindowBounds({ windowId, bounds: { windowState: 'normal' } });
    }
    await client.Browser.setWindowBounds({
      windowId,
      bounds: { left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(height) },
    });
  }

  return {
    targetUrl: page.url,
    setBounds,
    getBounds: async () => (await client.Browser.getWindowBounds({ windowId })).bounds,
    // Raises the Chrome window and makes the grailed tab its active tab, so
    // what lands next to the app is actually the sell form. Browser-level
    // command, purely window/tab UI — no script runs in the page.
    bringToFront: () => client.Target.activateTarget({ targetId: page.id }),
    onDisconnect: (cb) => client.on('disconnect', cb),
    close: () => client.close().catch(() => {}),
  };
}

module.exports = { connectDock };

// ---------------------------------------------------------------- CLI test mode
// Live verification without the app: snaps the Chrome window to the given
// bounds (default 100,100 1000x800), reads them back, restores nothing.
if (require.main === module) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd !== 'snap') {
    console.log('usage: node ui/chrome-dock.js snap [left top width height]');
    process.exit(cmd ? 1 : 0);
  }
  (async () => {
    console.log('== chrome-dock: snap ==');
    const dock = await connectDock();
    try {
      console.log('grailed tab:', dock.targetUrl);
      const before = await dock.getBounds();
      console.log('bounds before:', JSON.stringify(before));
      const [left, top, width, height] = rest.length === 4 ? rest.map(Number) : [100, 100, 1000, 800];
      await dock.bringToFront();
      await dock.setBounds({ left, top, width, height });
      const after = await dock.getBounds();
      console.log('bounds after:', JSON.stringify(after));
      const ok = after.left === left && after.top === top && after.width === width && after.height === height;
      console.log(ok ? '\n✅ window moved to the requested bounds.' : '\n⚠️  window bounds differ from the request — see above.');
    } finally {
      await dock.close();
    }
  })().catch((e) => {
    console.error('❌', e.message);
    process.exit(1);
  });
}
