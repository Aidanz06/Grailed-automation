# CLAUDE.md — Resale Studio / Grailed automation

@docs/PRD.md

## Current status
Phase 0b COMPLETE — §8.5 cleared (Runtime.enable + evaluate: no
detection). Slice 6 autofill built and live-verified (2026-07-03):
`ui/autofill-driver.js` (CDP :9222) fills title/description/price/
condition/color/style/country-of-origin + photos via the app's
"Fill listing" button (`autofill:fill` IPC). Category/size/designer
stay manual (cascade policy). Filled values are NOT server-saved
until the user clicks Save as Draft/Publish in Chrome — a page
reload restores Grailed's last saved draft. §5.5 "one window" BUILT
2026-07-03 as WINDOW DOCKING (`ui/chrome-dock.js`, `dock:start/stop`
IPC, "Dock Chrome" toggle): the real Chrome window is snapped against
the app via CDP Browser.setWindowBounds — cross-platform, no page
script, no input forwarding. A screencast panel was built first and
rolled back the same day (user decision). CLI-verified live; in-app
docking awaits a human eyes-on pass. A1 (category/size/designer) BUILT
2026-07-03 per the agreed sequence in docs/PLANS-v1-vs-extension.md
(finish v1, THEN swap to an extension+companion shell): the full
cascade (nested category → size → sub-category → designer) is
live-verified end-to-end through `fillListing`, gated by STAGED
CONFIRMATION — the DraftEditor "Grailed category" card suggests,
the user confirms (sets attributes.grailed_department/_category),
and only then does ui/main.js pass cascade fields to the driver.
Never blind-fill the cascade. 2026-07-04 cascade fixes (live-
verified): free-text subcategory is translated via
grailed-selectors.json appValueRules (Tops captured live; unmatched
→ raw passthrough), dropdown/category failures now Escape-close
their menu (an open menu was swallowing the next field's input),
and autocomplete suggestion polling replaces the fixed 900ms wait. AI vision: decision (batched-vision
default, descriptor-improved fallback) AND hardening are DONE
2026-07-04 — sharp bundled, auto-fallback + large-shoot guard,
batch progress bar, singleton/flag explanations, clustering:gate
regression script, grouping telemetry. Run `npm run
clustering:gate` before shipping pipeline/ clustering changes.
Clustering finish+verify pass 2026-07-04: live harness P=R=1.00
9/9 + stability 5/5 with the final downscale+EXIF prompt; sharp
proven inside Electron 43 (N-API prebuilt, no electron-rebuild);
>75-photo policy DECIDED = graceful per-photo fallback (guard
throws pre-API, verified keyless on 80 files); background import
no longer yanks navigation (App navRef gates the Q6 jump;
ImportScreen re-attaches to a running batch on remount).
413 fix (found by the first real-shoot import): extractAttributes
+ describePhoto now downscale before sending (shared ladder,
1568px start) — only the grouping call did before; and one group
failing during pricing/writing is parked in Review
(processing_failed flag carrying the real error; confirm retries)
instead of aborting the whole import. Real-run feedback round
(2026-07-04, 38-photo batch): comps are clickable (open:external
IPC, grailed.com-only allowlist → system browser); ImportScreen
shows a post-import SUMMARY (per-group rows + Open buttons,
survives remount; replaces the Q6 auto-jump); generated listing
text never mentions authenticity (prompt rule + sentence scrub in
content.js — regenerate pre-existing drafts to clean them);
DraftEditor photo grid streamlined (240px thumbnail left, 116px
tiles packing beside it); OWNER DECISION: cascade category +
color are now AUTO-SELECTED from AI attributes when they validate
against grailed-selectors.json (visible in the card with Change,
main.js gate unchanged — only values set in the app are filled;
the manual picker remains when no confident suggestion).
UX-review execution (REMAINING-WORK §D2): trust pass DONE
(persistent not-saved-on-Grailed banner, real error messages
everywhere, de-stubbed UI, descParts/measurements save fix) and
S1 DONE (ReviewScreen now really confirms/splits/reassigns flagged
groups; corrections recorded as §5.6 telemetry). 2026-07-04
redesign DONE: DraftEditor is two-column — sticky right rail with
ListingChecklist (n/7 readiness rows, click-to-jump), rewritten
PricePanel (price card + comps sparkline), actions + fill banner;
batch grouping streams REAL progress (strategy opts.onProgress:
per-photo prepare/describe, analyze, fallback → ImportScreen
3-step checklist + weighted bar). S5 counterfeit-ack gate SKIPPED
for v1 (user decision — personal use; revisit before any
distribution). S3 DONE 2026-07-04 (live-verified): fillListing
streams transport-agnostic per-field events (plan +
filling/ok/failed/skipped, photo slot counts) → autofill:progress
IPC → FillProgressCard live checklist in the DraftEditor rail
(persists as "Last fill"). Same day: DraftEditor photo tiles
enlarged (thumbnail 240×192 largest), Sidebar rows show 64px
photo thumbnails + count chip; studio-blend RETHEME (user-picked
from 3 mocks): brass primary + teal success tokens, Space
Grotesk/JetBrains Mono/Instrument Serif via @fontsource, lucide
icons replace all emoji, motion system (ui/src/components/
motion.tsx: drawn checks, glow dots, gradient shimmer bars,
PhotoShuffler batch loader) with reduced-motion support.
Q6/Q4/S6/status-vocab DONE 2026-07-04 — the UX-review list is
now fully closed (S5 skipped by user decision): import jumps to
the first new draft, legacy no-descParts items get a Regenerate
hint, "Mark listed" asks for confirmation, submitted badge reads
"listed". Home rows got a two-step permanent Delete (app-DB only,
cascade; Grailed + photo files untouched). Workflow round
2026-07-04 (all preview-verified, real-run pending): ALBUMS —
one per import batch (albums table + items.album_id migration,
albums:list/setHidden IPC); Home's lists hide items of hidden
albums via an "Albums — past imports" section (hide/show, counts;
nothing deleted, workspace sidebar unaffected). LISTED→FILL-NEXT —
the post-fill banner's "I published — fill next draft" marks the
item listed, advances to the next draft (sidebar order), and starts
that item's fill; the ONE click is the per-item manual trigger
(App.autoFillId → DraftEditor autoFill-on-mount; still no submit,
no Chrome state inference). MEASUREMENTS — category templates in
ui/src/lib/measurements.ts (tops pit-to-pit/length/shoulders/
sleeve; bottoms waist/inseam/rise/leg-opening; footwear tagged
size/outsole; Measurements type is now Record<string,string>,
legacy chest/… keys with values still render) + Home "Measure"
batch mode (MeasureScreen: tab through every draft, debounced
saves). STREAMED DRAFTS — batch:process announces each saved item
on batch:progress (`item` field); App reloads lists incrementally
and ImportScreen offers "Start editing" on the first draft while
the rest still process. Real-run fix round #2 (2026-07-04, LV
light-jacket test): photo deletes/reorders now PERSIST
(photos.position migration; saveItemEdits accepts the id list;
every DraftEditor save sends it) so autofill can't upload a
deleted photo and drag order = upload order; fillAutocomplete
polls while the designer input is still disabled (async enable
after category — the likely "Louis Vuitton not found" cause,
needs live re-test) + whitespace/case-normalized matching + real
failure reasons in the fill toast; grailed-selectors.json gained
Outerwear appValueRules ("light jacket" → "Light Jackets" etc.,
best-effort labels, clean failure lists real options). Haiku 4.5
cost test 2026-07-04: VERDICT = content-only mix
(CONTENT_MODEL=haiku live in .env.local, ~$0.85→$0.70/import) —
Haiku grouping FAILED stability (wrong-AA=1 in 2/5 runs) and
Haiku attributes erred on 2/9 items (wrong size, jersey→jacket)
with pegged 0.95 brand confidence, so CLUSTER/ATTRIBUTE stay
Opus; cluster.js gained supportsThinking/thinkingConfig (Haiku
400s on adaptive thinking). 2026-07-05: comp links fixed
(computeRange kept `url` out of mostRelevantComps → rows rendered
unlinked; now kept + UI backfills legacy items from the comps
rows) and the estimate gained CONFIDENCE (range.js confidenceFor:
duplicate sold listings → high, loose comps → low, demotions for
wide spread/thin Kish nEff; ci95 on the median; PricePanel badge
+ "likely $lo–$hi" + explanation — legacy items need one
Recompute to get it, cache-served). Chrome STATUS + fresh-Sell
gate BUILT 2026-07-05 (audit §3.1/§3.2): ui/chrome-status.js
probes ONLY :9222/json/list over HTTP (no WebSocket/
Runtime.enable/page script — keep it that way), URL patterns in
grailed-selectors.json `sellForm`; chrome:status IPC →
ChromeStatusChip in the workspace header (not connected / Open a
Sell form / Sign in to Grailed / ready, 4s poll); DraftEditor
gates fills on it — manual fill blocked w/ Recheck + Fill-anyway
card, listed→fill-next auto-fires ONLY onto a fresh Sell form,
else the fill button ARMS (one manual click per item preserved).
Probe never touches the §8.1 breaker; user-facing copy de-
jargoned (no npm commands). Mock-preview verified all states;
live three-state re-test pending. Awaiting a human eyes-on
pass in the app. In-app Chrome LAUNCH BUILT 2026-07-05:
ui/chrome-launch.js (phase0b launch() extracted — same binary /
.chrome-profile / :9222, detached spawn, stock flags only,
friendly no-op when the port is already up) → chrome:launch IPC;
"Launch Chrome" appears beside the not-connected ChromeStatusChip
(toast prop from App) and in the DraftEditor fill-blocked card
(launch → auto-Recheck). api.ts mock Chrome state is now a
tri-state (ready/no-sell-form/disconnected) whose mock launcher
advances disconnected→no-sell-form so the whole walk previews.
Preview-verified end-to-end + CLI no-op branch verified against
the live Chrome; the fresh-spawn path (no Chrome up → click →
window appears → chip flips) awaits the human pass. Home
CHROME NOTIFIER BUILT 2026-07-05: chip poll/launch extracted to
useChromeStatus/useLaunchChrome (ChromeStatusChip.tsx, shared —
Home and workspace never mount together) → ChromeNotifier.tsx, a
full-width status row at the top of Home (not running w/ Launch
button / sign in / open-a-Sell-form / ready) fed by App's toast;
preview-verified across all four states incl. the launch →
open-a-Sell-form transition. 2026-07-06: OPEN-SELL-TAB +
CHANGE-AWARE RE-FILL BUILT. openSellTab (ui/chrome-launch.js):
one DevTools-HTTP PUT /json/new (GET fallback) + /json/activate —
creates a NEW tab on sellForm.url from grailed-selectors.json,
never navigates existing tabs, no page script; chrome:openSellTab
IPC → "Open Sell form" button on the Home ChromeNotifier and the
DraftEditor fill-blocked card (opens then auto-Rechecks);
LIVE-verified CLI (real Chrome: no-sell-form → ready). Re-fill:
items.last_fill_json (try/catch migration + store.setLastFill,
roundtrip-tested) snapshots app-level field values per fill,
advancing per-field only on driver ok; ui/main.js buildFillPayload
(extracted — fill + diff share it), autofill:changes IPC diffs
current vs snapshot; fillListing(id,{changedOnly}) nulls unchanged
fields and NEVER re-sends photos (upload appends → duplicates).
Photo changes are NOT tracked/diffed at all (owner decision
2026-07-06 — photos are adjusted directly on the Grailed form; the
card's footer says so). DraftEditor: FillChangesCard (was→now rows
+ status words; live statuses only DURING a run, only `failed`
persists after — an older run's ok must not label a fresh edit
"filled"), primary button becomes "Fill N change(s)
in Chrome" (changed-only) with "Fill everything again (fresh
form)" secondary — full fill stays default for armed/fill-next
(fresh form, no old values to diff against). Preview-verified
full cycle (fill → edit demo diff → changed-only fill → card
clears); real changed-only fill against a live form pending
eyes-on.

## Non-negotiable rules
- Never apply navigator/fingerprint/UA spoofing anywhere in this
  project, embedded or real Chrome. Confirmed counterproductive
  (PRD §8.3) — it makes detection worse, not better.
- Login and captcha-solving happen manually, by a human, in a real
  separately-launched Chrome. Never attempt this in Electron's
  embedded browser engine (PRD §8.2).
- Before writing `CDP.evaluate`-based fill logic, confirm enabling the
  CDP Runtime domain doesn't itself trigger detection (PRD §8.5). If it
  does, pivot to a browser-extension-based content-script fill instead
  of pushing further on CDP.
- DOM selectors live in an external `grailed-selectors.json`, never
  hardcoded in application code.
- The app never submits the Grailed form on its own. The user always
  manually reviews and clicks submit.
- If the Grailed account receives any warning or flag, disable
  scraping and autofill immediately (circuit breaker, PRD §8.1) rather
  than continuing to test the boundary.
- No autonomous bumping, offer-sending, or messaging — form-fill
  assistance only, manually triggered per item.

## When context matters more than this file
For full feature scope, data model, roadmap, and complete risk
detail, read docs/PRD.md directly — this file only holds what should
change your behavior in every session.
