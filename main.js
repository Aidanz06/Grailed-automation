const { app, BrowserWindow, BrowserView, globalShortcut } = require('electron');

// --- The fill script -----------------------------------------------------
// Runs INSIDE the Grailed page (BrowserView web contents), not in Node.
// Grailed's sell form is React-controlled, so a plain `input.value = x`
// write is ignored: React's synthetic event system never sees it and
// re-renders the field back to its own state value. We work around that by
// calling the *native* HTMLInputElement value setter (which bypasses React's
// value-tracker shim) and then dispatching a bubbling 'input' event so React
// picks up the change through its normal delegated listener.
//
// The function returns a small result object that we log on the Node side.
function buildFillScript(testValue) {
  return `(() => {
    // Try a few selectors Grailed has used for the listing title field.
    const candidates = [
      'input[name="title"]',
      'input#title',
      'input[placeholder*="title" i]',
      'input[aria-label*="title" i]',
      'input[data-testid*="title" i]'
    ];

    let input = null;
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) { input = el; break; }
    }

    if (!input) {
      return { ok: false, reason: 'title-input-not-found', url: location.href };
    }

    const before = input.value;

    // Grab the NATIVE setter, bypassing React's overridden value property.
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    ).set;

    input.focus();
    nativeSetter.call(input, ${JSON.stringify(testValue)});

    // Fire a real 'input' event so React's onChange handler runs.
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    const after = input.value;

    return {
      ok: true,
      selectorMatched: input.getAttribute('name') || input.id || input.placeholder || '(matched)',
      before,
      after,
      changed: after === ${JSON.stringify(testValue)} && after !== before,
      url: location.href
    };
  })();`;
}

let mainWindow;
let view;

const PARTITION = 'persist:grailed'; // "persist:" prefix => on-disk, survives restart
const TEST_TITLE = 'POC test title ' + Date.now();

function runFill() {
  if (!view) return;
  const script = buildFillScript(TEST_TITLE);
  view.webContents
    .executeJavaScript(script, true)
    .then((result) => {
      console.log('\n===== FILL RESULT =====');
      console.log(JSON.stringify(result, null, 2));
      if (result && result.ok && result.changed) {
        console.log('✅ Field visibly updated: "%s" -> "%s"', result.before, result.after);
      } else if (result && result.ok && !result.changed) {
        console.log('⚠️  Found the input but value did not stick (React may have reverted it).');
      } else {
        console.log('❌ Could not fill: %s (are you on the sell page?)', result && result.reason);
      }
      console.log('=======================\n');
    })
    .catch((err) => {
      console.error('❌ executeJavaScript failed:', err);
    });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    title: 'Grailed Automation POC'
  });

  // Named persistent session partition. Because it starts with "persist:",
  // cookies / localStorage / login state are written to disk and reused on
  // the next launch. (Pass the partition string only — Electron errors if
  // both `session` and `partition` are given.)
  view = new BrowserView({
    webPreferences: {
      partition: PARTITION,
      // Kept CLEAN on purpose. JS-level navigator spoofing (userAgentData,
      // webdriver, etc.) is itself detectable tampering and made Grailed's
      // anti-bot block us HARDER (instant 403, no captcha). An honest,
      // untampered Chromium that lets the human solve the captcha gets further.
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setBrowserView(view);

  const resize = () => {
    const { width, height } = mainWindow.getContentBounds();
    view.setBounds({ x: 0, y: 0, width, height });
  };
  resize();
  view.setAutoResize({ width: true, height: true });
  mainWindow.on('resize', resize);

  // Grailed's bot protection (HUMAN/PerimeterX) rejects requests whose
  // identity looks inconsistent. Electron 33 bundles Chromium 130, so we
  // present a matching Chrome 130 UA *and* rewrite the low-level Sec-CH-UA
  // client-hint headers, which otherwise still advertise "Electron" and
  // create a UA-vs-client-hint mismatch that anti-bot systems flag.
  const CHROME_UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  view.webContents.setUserAgent(CHROME_UA);

  view.webContents.session.webRequest.onBeforeSendHeaders((details, cb) => {
    const h = details.requestHeaders;
    if ('sec-ch-ua' in h || 'Sec-CH-UA' in h) {
      h['sec-ch-ua'] =
        '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"';
      delete h['Sec-CH-UA'];
    }
    if ('sec-ch-ua-full-version-list' in h) {
      h['sec-ch-ua-full-version-list'] =
        '"Chromium";v="130.0.6723.0", "Google Chrome";v="130.0.6723.0", "Not?A_Brand";v="99.0.0.0"';
    }
    cb({ requestHeaders: h });
  });

  // Fingerprint hygiene is now handled by preload.js, which runs in the page's
  // main world at document-start (see webPreferences above). Just load.
  view.webContents.loadURL('https://www.grailed.com');

  // Surface renderer crashes / hangs that would show as a white screen.
  view.webContents.on('render-process-gone', (_e, d) =>
    console.log('[render-process-gone]', JSON.stringify(d))
  );
  view.webContents.on('did-finish-load', () => {
    console.log('[did-finish-load]');
    // Confirm the preload overrides are actually live in the page.
    view.webContents
      .executeJavaScript(
        `({ webdriver: navigator.webdriver,
            platform: navigator.platform,
            brands: (navigator.userAgentData && navigator.userAgentData.brands) || null })`,
        true
      )
      .then((v) => console.log('[hygiene-check]', JSON.stringify(v)))
      .catch(() => {});
  });
  view.webContents.on('dom-ready', () => console.log('[dom-ready]'));

  // Helpful log so you can confirm which URL the view is on before filling.
  view.webContents.on('did-navigate', (_e, url) =>
    console.log('[nav] ', url)
  );
  view.webContents.on('did-navigate-in-page', (_e, url) =>
    console.log('[nav-in-page] ', url)
  );

  // --- Diagnostics: surface what the page can't tell us visually ----------
  // Page-side console output (JS errors from the login form show up here).
  view.webContents.on('console-message', (_e, level, message, line, source) => {
    const tag = ['log', 'warn', 'error', 'info'][level] || 'log';
    console.log(`[page:${tag}] ${message}`);
  });

  // Hard load failures.
  view.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.log(`[did-fail-load] ${code} ${desc} -> ${url}`);
  });

  // Failed network responses (4xx/5xx) — e.g. a rejected login POST.
  view.webContents.session.webRequest.onCompleted((details) => {
    if (details.statusCode >= 400) {
      console.log(`[net ${details.statusCode}] ${details.method} ${details.url}`);
    }
  });
  view.webContents.session.webRequest.onErrorOccurred((details) => {
    console.log(`[net-error] ${details.error} ${details.method} ${details.url}`);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    view = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  // Trigger the fill script: Cmd+Shift+F (macOS) / Ctrl+Shift+F.
  const accelerator = 'CommandOrControl+Shift+F';
  const ok = globalShortcut.register(accelerator, runFill);
  console.log(
    ok
      ? `\n>>> Ready. Log in + navigate to the sell page, then press ${accelerator} to run the fill script.\n`
      : '⚠️  Failed to register global shortcut.'
  );

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
