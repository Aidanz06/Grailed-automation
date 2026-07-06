# Build prompt — Chrome tab status + fresh-Sell-form guard (audit §3.1 / §3.2)

Implement the highest-leverage usability/correctness fix from
`docs/UX-AUDIT-inputs.md`: make the launched Chrome's state **visible** in the
app, and stop a fill (especially the auto-fill-next chain) from pouring a draft
into the wrong Chrome page. Read `CLAUDE.md` (non-negotiables) and the audit §3.1
/ §3.2 first.

This one **does** touch the CDP/driver layer (a read-only status probe) and
`ui/main.js` IPC — that is intended and in scope for *this* task, but it is
tightly bounded by the detection rules below.

## Hard constraints (read before writing any CDP code)

- **Detection-safe reads only.** Get Chrome's tab list via the CDP **HTTP**
  endpoint — `chrome-remote-interface`'s `CDP.List({ port: 9222 })` (i.e.
  `GET http://localhost:9222/json/list`). This returns every target's `type`,
  `url`, and `title` with **no WebSocket, no `Runtime.enable`, no page
  injection** — zero detection surface. Do **not** add a `Runtime.enable` /
  `Runtime.evaluate` path for status. (`Runtime.enable` was cleared in §8.5 for
  the *fill*, but the status probe must not need it.)
- **Never** add navigator/UA/fingerprint spoofing anywhere (§8.3).
- The app **still never submits**, and the status gate must **not** remove the
  one manual click per item — it only makes that click safe. Auto-fill-next may
  fire automatically **only** when the probe says Chrome is ready; otherwise it
  must fall back to a single explicit user click.
- **Login/captcha stay manual.** The probe may *infer* "not signed in" only from
  a public URL signal (e.g. the Grailed tab sitting on `/users/sign_up` or a
  login route); it must never read credentials, cookies, or attempt auto-login.
- Sell-form URL patterns are configuration, not magic strings — put them in
  `grailed-selectors.json` (e.g. a `sellForm` block with the `/sell/new` URL and
  any login-route patterns), consistent with the "selectors live in JSON" rule.
- Respect the circuit breaker for *actions*, but the status probe is passive and
  may run regardless; do not let it trip or interact with the breaker.

## Part A — driver/IPC: a read-only Chrome status probe

**Files:** `ui/autofill-driver.js` (or a small sibling like `ui/chrome-status.js`
reusing the same connection style as `ui/chrome-dock.js`), `ui/main.js`,
`ui/preload.js`.

Add `getChromeStatus()` that, using `CDP.List` on :9222:

```
{
  connected:    boolean,        // endpoint reachable
  loggedIn:     boolean | null, // false only if a Grailed tab is on a login/signup route; null if unknown
  sellFormTabs: number,         // count of page targets whose url matches the sellForm pattern
  activeUrl:    string | null,  // a representative Grailed page url (best-effort)
  ready:        boolean         // connected && sellFormTabs >= 1 && loggedIn !== false
}
```

- Filter `type === 'page'`; match `url` against the `sellForm` pattern from
  `grailed-selectors.json`. Treat connection-refused / fetch error as
  `{ connected:false, ready:false, … }` (Chrome not launched) — never throw to
  the UI.
- Expose via `ipcMain.handle('chrome:status', …)` → `window.tailor.getChromeStatus`
  in `preload.js`. Keep it fast (single HTTP round-trip) and side-effect free.
- CLI-verify the probe (e.g. `node ui/autofill-driver.js status`) against the
  launched Chrome across three states: not launched, on some other page, and on
  `grailed.com/sell/new`. Confirm **zero** detection signals (it never opens a
  socket to a page target).

## Part B — data layer

**File:** `ui/src/lib/api.ts`.

Add `getChromeStatus(): Promise<ChromeStatus>` to the `Api` interface with a real
impl (calls `window.tailor.getChromeStatus`) and a **mock** impl. Mock default
`{ connected:true, loggedIn:true, sellFormTabs:1, activeUrl:'…/sell/new',
ready:true }` so the UI previews as "ready"; add a simple way to preview the
not-ready state (e.g. a mock toggle or a commented constant) so the warning UI
can be walked in `ui:dev`.

## Part C — status chip in the workspace header

**Files:** `ui/src/App.tsx`, optionally a new
`ui/src/components/ChromeStatusChip.tsx`.

- Poll `getChromeStatus()` every ~4s while `view === 'workspace'` (clear the
  interval otherwise), plus an immediate check on entering the workspace.
- Render a compact chip (lucide icon, studio-blend tokens — teal success / warm
  warning; no emoji) with three states:
  - `connected === false` → **"Chrome not connected"** — tooltip: *"Open the
    Tailor-launched Chrome and sign in to Grailed."*
  - `connected && !ready` → **"Open a Sell form"** (warning) — tooltip:
    *"Point that Chrome at grailed.com/sell/new so Fill has a fresh form."*
    (If `loggedIn === false`, say **"Sign in to Grailed"** instead.)
  - `ready` → **"Chrome ready"** (success).
- Place it near the Dock Chrome button. It shares the same launched Chrome, so
  it also answers "is Dock going to work?" implicitly.

## Part D — gate the fill on a fresh Sell form

**File:** `ui/src/components/DraftEditor.tsx`.

1. **Manual fill:** before `fillListing()` calls `api.fillListing`, fetch
   `getChromeStatus()`. If **not ready**, do **not** fill; show a persistent
   warning card (reuse the not-saved banner styling): *"Chrome isn't on a fresh
   Sell form. Open grailed.com/sell/new in the launched Chrome, then Fill."* with
   two buttons: **Recheck** (re-probe) and **Fill anyway** (respect user
   autonomy — proceeds exactly as today). If ready, proceed unchanged.
2. **Auto-fill-next (the §3.1 hazard):** in the `autoFill`-on-mount effect,
   probe first. If **ready**, keep today's behavior (fire the fill — the prior
   item's publish-next click was the trigger). If **not ready**, do **not**
   auto-fire; instead show an **armed** state: the fill button glows and reads
   **"Chrome ready on a new Sell form? — Fill this draft"**, and the reminder card
   from (1) is shown. The single click stays the manual trigger; nothing fires
   into a stale tab.
3. Keep the `FillProgressCard` behavior; optionally prepend a one-line
   *"Filling into the Chrome tab on the Sell form"* while running.

## Part E — de-jargon the Chrome copy (§3.2)

Remove developer commands from **user-facing** strings (keep them in docs):

- `DraftEditor.tsx` helper line under the fill button ("Fill needs the launched
  Chrome (npm run 0b:launch)…") → reword to human steps, and defer the live
  state to the status chip: *"Fill types into the launched Chrome on Grailed's
  Sell page — it never submits. Watch the Chrome-status chip up top."*
- Dock Chrome tooltip in `App.tsx` → drop `npm run 0b:launch`; describe it in
  plain language.

## Verification (required)

1. `npm run ui:typecheck` clean. (`ui:build` may fail in a non-macOS sandbox on a
   native rolldown binary — that's environmental, not code; build on macOS.)
2. CLI: `getChromeStatus` returns correct `connected/ready` across the three
   Chrome states (Part A), with no detection signals.
3. Live: with Chrome **not** on `/sell/new`, confirm a manual fill is blocked with
   the warning + Recheck/Fill-anyway, and that publish-next on the previous item
   **does not** auto-fire into the stale tab (armed button instead). Move Chrome
   to `/sell/new`, Recheck → chip goes "ready" → fill proceeds. Full
   fill→publish→next chain works when Chrome is kept on fresh Sell forms.
4. Mock preview (`ui:dev`): chip renders all three states; the warning/armed UI is
   reachable via the mock not-ready toggle.
5. Reconfirm constraints: no `Runtime.enable` in the status path, no spoofing, no
   submit, one click per item preserved, sell-form patterns in
   `grailed-selectors.json`.

## Notes

- This is the fix that actually prevents wrong-page fills; ship it ahead of the
  §2 click-polish if sequencing.
- Do not attempt Chrome **navigation** from the app in this task (auto-opening
  `/sell/new` is a separate, heavier decision in the audit's recommend-only
  list). Here the app only *reads* state and *guides* the user.
