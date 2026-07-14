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
eyes-on. 2026-07-12: UX-streamlining (R1–R5) + friend-beta (A–G)
BUILT — renderer/state + one read-only IPC only; preview-verified
end-to-end (scripted Electron walk of the ui:dev mock, 0 console
errors). R1: lib/readiness.ts is the SINGLE readiness source
(extracted from ListingChecklist buildRows) — sidebar triage chips
(Ready / top blocker), triageSort (review → needs-attention →
ready → listed; App's J/K + fill-next queue share the order),
All/Needs-attention/Ready filter. R2: FinishScreen — one pass,
ONLY unresolved required fields per draft (inline combined
category picker keeps the staged Confirm gate; brand/size
"verified" buttons record user judgment), debounced saveItem;
"Finish drafts (n)" on Home + workspace headers. R3:
lib/shortcuts.ts is the single bindings source (key handler AND
the guide render from it): J/K/↓↑ next-prev, Cmd/Ctrl+Enter
save-and-next, F = the same gated fillListing path (one keypress
per item; probe/blocked card unchanged), ? = guide. R4: sidebar
multi-select + BulkActionBar (condition / tag add-remove /
description style / per-item Recompute; size/measurements/price
VALUES excluded by design; album-assign SKIPPED — would need a
store column, pipeline off-limits). R5: FillTracker strip
(album-scoped "n of m listed" + next queued; its button = the
existing autoFillId manual trigger). Beta: Onboarding first-run
modal (tailor.onboarded) + GuideMenu behind "?" in both headers
(how-it-works / screens / shortcuts-from-shortcuts.ts / trust
contract / troubleshooting / glossary), Home live GettingStarted
checklist (folds ChromeNotifier into step 2; hides once anything
is listed), de-jargoned circuit-breaker/import/PricePanel copy +
directional empty/error states, config:status IPC (BOOLEANS ONLY:
ANTHROPIC_API_KEY / GRAILED_ALGOLIA_KEY presence) → calm keyless
banners + friendly import-failure routing, one-time first-fill
heads-up (tailor.firstFillConfirmed). Real keyless-build launch
and a live F-key/fill pass await eyes-on. 2026-07-12 later: photo
bug F FIXED + LIVE-VERIFIED (plan §F): fillListing with photos now
opens its OWN fresh /sell/new tab (driver openFreshSellTab —
DevTools-HTTP /json/new, binds by target id; URL from
grailed-selectors.json sellForm.url) and REFUSES any form whose
photo slots aren't all empty (empty = one file input per
photos.slots; checked up-front in fillListing AND in uploadPhotos)
— photos are never appended to a previous listing's set.
Changed-only re-fills (photoPaths nulled by main.js) deliberately
keep targeting the existing form (newest/active sell tab —
/json lists most-recently-focused first). chrome-status stays
HTTP-only (can't see emptiness — by rule, no page script); the
driver no longer trusts "ready" for photo safety. Live-verified
(real Chrome): fresh fill ok ×2 (each tab exactly its own photo,
3 sell tabs open — per-id binding held), upload onto non-empty
form refused w/ clear message, 0 media POSTs on refusal, no
detection signals. CLI modes added: `slots` (read-only emptiness
diag), `fresh-fill` (end-to-end app path). Renderer gate/copy
("Chrome ready", armed fill-next) intentionally untouched —
loosening it now that fills self-provision a tab is an OPEN
QUESTION for the owner. Same day, plan §B/§H/§C/§E: default
description profile = Minimal (presets intact); titles drop the
designer/brand (goes in the designer field; <7 words, alternates
too) via CONTENT_SCHEMA + system rule; content hard rules added —
facts only from attributes (never invent color/material/collab/
era), objective tone w/ banned-hype list, wear adjectives only in
flaws, rating-based condition — plus stripHypeLines backstop
(sentence-level, conservative curated list; "clean" banned in
prompt but NOT scrubbed — legit in condition text; shares
scrubBodyText with the authenticity scrub); PhotoRow tiles show
live 1-based position badges from render index ("1 · thumbnail"),
renumbering on reorder/delete. Live-verified: 2 real generations
(brandless titles, colors exact, no hype); scrub unit-smoked.
Designer bug G HARDENED + LIVE-VERIFIED (plan §G):
fillAutocomplete now (1) clicks only after the suggestion list
SETTLES (same items on two consecutive polls; budget-end match
still clicked), (2) verifies the committed value and retries the
whole type→poll→click up to 2× with growing backoff, (3) on final
failure CLEARS the typed fragment (acClearExpr, same native-setter
technique — no new surface) + reports "pick it manually" with the
suggestions seen. Timings are config: grailed-selectors.json
autocompletes._timing (pollMs/pollTries/retries/retryBackoffMs).
GOTCHA fixed during live verify: acFocusExpr's alreadySet
short-circuit must apply ONLY on attempt 1 — on retries the input
holds our own uncommitted typing (== want by construction), which
false-positived as success and left the field half-typed (the
exact bug being fixed). Live runs: Portugal, Louis Vuitton ×2,
Carhartt ×2, Stone Island all committed attempt 1 (no manual
click); nonsense brand → 3 attempts → field cleared + clean
message → next fill on the same field worked normally; no
detection signals anywhere. Plan §D/§D2 BUILT (condition +
pricing): vision.js condition_rating enum is now the UI's four
values ('New with tags'/'Gently used'/'Used'/'Unclear') with
evidence-based rules (tags attached/unworn → NWT; Used ONLY on
visible wear; ambiguous → Unclear, NEVER default Used;
condition_markers also capture newness signals) — the autofill
appValueMap already covered both vocabs, and range.js
itemConditionOrd still parses the legacy enum on stored items.
range.js: `median` (the field the whole app treats as your-price/
autofill price) is now the recommended LIST price (weighted 70th
pct of sold, never below the sold median); `soldMedian` carries
the expected-sale figure; low fence still drops junk-cheap comps
but high outliers are DOWNWEIGHTED (×0.5), not dropped;
brandMatchFactor(×0.55 when the comp title lacks the brand —
own normalization, NOT tokenize(), whose STOPWORDS eat
nike/adidas/puma) tightens relevance without touching the guarded
provider; NWT items get a steeper conditionProximity (is_new 1.0 /
gently 0.45 / used 0.25) and <3 is_new comps → confidence demoted
+ explanation notes it (newCompCount on the range). PricePanel:
"list price — typically sells ~$X" split, "likely sells" CI
wording, NWT badge + thin-comps note; UI PriceRange gained
soldMedian/listAt/newCompCount/outliersDownweighted (adapters +
mock updated). Verified: synthetic NWT-vs-used harness (NWT sells
78 > used 61 on the same comps; list ≥ sells; high sale
downweighted; thin-NWT → low conf + note; legacy vocab ok);
typecheck clean. clustering:gate NOT run — cluster.js/
groupingStrategy.js untouched (vision schema + range math only).
PENDING eyes-on: real NWT-garment extraction + recompute of a few
real items to sanity-check list prices against seller judgment.
Plan §A BUILT (description style template): settings table in
pipeline/store.js (key/value + getSetting/setSetting; empty value
deletes) — the ONE persistent setting store both generation paths
read; settings:get/set IPC (generic; key
'descriptionStyleTemplate' duplicated in ui/main.js +
ui/src/lib/api.ts, grep-able); generateContent(attributes,
{ styleExample }) appends the seller's example BELOW the hard
rules ("subordinate to EVERY hard rule above — those always win…
never copy its specific details, measurements, or price"); unset →
prompt byte-identical (stub-verified). Wired into batch import,
review:confirm, and Regenerate via main.js styleTemplate() (never
throws — settings can't block generation). UI: pencil button in
DraftEditor's Description header → inline panel (load/save/clear +
"Save & regenerate with my style"); mock persists to localStorage
so the preview survives reload. Verified: temp-DB reopen
round-trip; stubbed-client prompt checks; LIVE booby-trapped
template (price/measurement/'grail'/other item) → zero leaks,
hard rules won; LIVE benign template → visible style transfer
(structure/terse lines/shipping closer) with the item's own facts;
preview walk (pencil → type → save → reload → persisted, 0 console
errors). Real end-to-end (app restart → set template → import
batch) awaits eyes-on. Owner feedback round 2026-07-12 later:
(1) SIMPLER DESCRIPTIONS — content.js description schema is now
overview + rating-based condition line ONLY (no materials/features
list and NO "Measurements (verify…)" blanks block — that block was
why measurements read as on-by-default despite the Minimal profile:
the fill payload sends content.description verbatim and only
DetailPanel toggling ever reassembled it); new hard rule (8) bans
wear trivia (minor lint/fuzz/pilling/stray threads/faint fading/
small scuffs) in ALL buyer-facing text incl. flaws (sale-relevant
defects only — holes/stains/tears/broken hardware/heavy fading);
stripMeasurementBlanks backstop scrubs the header line + ": __"
placeholder lines (real typed measurements untouched, unit-smoked);
legacy drafts keep their old body until Regenerate. (2) STYLE
ESTIMATE — vision.js grailed_style_estimate (enum built from
grailed-selectors.json dropdowns.style.options minus "None", plus
"Unclear"; the json stays the single source, hardcoded fallback only
if unreadable) and DraftEditor auto-adopts it into
attrs.grailed_style when it matches fillOptions.styles (same
pattern/gate as color — only app-set values are filled; "Unclear"
never matches). Verified: live gen with trivia-laden markers →
2-line body, zero minutiae, flaws empty, no blanks, brandless
title; stub prompt checks all green; offscreen preview walk (mock
jersey's Style select auto-shows "Sportswear", 0 console errors);
ui:typecheck clean. Existing items need a re-import for a style
estimate; Regenerate cleans old verbose bodies. Plan §I SMART
PRICING BUILT + LIVE-VERIFIED 2026-07-12: fills Grailed's NATIVE
Smart Pricing (toggle + floor) STRICTLY opt-in per item — never
auto-enabled, never autonomous, user still reviews/publishes.
grailed-selectors.json `smartPricing` block (re-captured live,
read-only probe; toggle input[name="smartPricing.enabled"] behind
a styled switch — synthetic el.click() flips it; floor
input[name="smartPricing.minimumPrice"] type=tel native-setter;
CAVEAT: Grailed's fresh form renders the toggle ON by default with
empty floor — driver treats that as alreadySet and NEVER touches
the section unless opted in). Driver: checkboxExpr/setCheckbox
(idempotent), fillListing 'smartPricing' step (enable → type
floor) gated on fields.smartPricingFloor != null — that single
scalar IS the opt-in (ui/main.js buildFillPayload sets it only
when attrs.smart_pricing_enabled && smart_pricing_floor, so the
String() diff + changed-only path work unchanged); streams in the
S3 checklist (FIELD_LABEL += smartPricing). UI: PricePanel opt-in
card (default OFF; enabling seeds the floor from r.soldMedian =
the D2 "list at $Y, floor at $X" pairing, "use ~$X (typical
sale)" button, no-floor warning = fill skips); attrs
smart_pricing_enabled/_floor ride attributes_json (no migration).
CLI mode `smart-pricing [floor]`. Live-verified: toggle off→on→
alreadySet all ok, 0 detection signals; fillListing opted-in →
plan includes smartPricing, floor typed (62); non-opted →
smartPricing absent from plan, section untouched; preview walk
default-off → enable → floor appears, 0 console errors;
ui:typecheck clean. Regression pass found+fixed same day: the
payload field was smartPricingFloor while the driver's step/
results key is smartPricing, so the last-fill snapshot never
advanced (changed-only would re-send it forever) — renamed the
payload field to `smartPricing` (value = the floor) to match;
re-verified live (floor 58 ok). Left on the active test sell tab:
TEST title, toggle ON, floor 58 — clear before real use.
IN-APP ONE-CLICK UPDATER BUILT + VERIFIED 2026-07-12 (main +
renderer plumbing ONLY; driver/pipeline/fill-IPC untouched):
ui/updater.js (spawn, cwd = repo root, functions take a root
param → CLI-testable: `node ui/updater.js check|apply [--root]`);
no .git → { supported:false } and ALL update UI hides. check =
git fetch + rev-list --count HEAD..@{u} (never throws — errors
come back as strings; no-upstream handled; ENOENT → "start from
Terminal so git/npm are on PATH"). apply = fetch → git stash iff
dirty (tracked files only; .env.local/data//.chrome-profile are
gitignored, proven untouched) → git pull --ff-only (diverged →
STOP w/ contact-the-owner copy, never merge/force) → npm install
→ npm run ui:build, streaming update:progress (step start/output/
done/failed, output throttled 250ms, 40-line tail kept for error
reports); success → main relaunches (app.relaunch + exit) after
1.2s. Cancel kills the current child ONLY before build (a killed
build = broken dist). Guard: main refuses while opts.busy (App
watches batch:progress non-terminal stages + a new DraftEditor
onFillingChange report threaded via Editor) or while an update
already runs. Renderer: ui/src/components/Updater.tsx (useUpdater
hook owns state; quiet check on launch → UpdateBanner strip
"Update & restart" + dismiss; CheckUpdatesButton in the Home
header (toasts up-to-date/behind/error); UpdateModal at App root —
4 steps w/ spinner/check/fail icons, live output tail, Cancel
disabled once building, failure view = failed step + message +
output tail + Copy-details, "your listings/settings/keys are
untouched" reassurance). api.ts mock: supported:true/no-update
(flip mockUpdateAvailable to preview), apply simulates the stream.
VERIFIED on a real behind-clone (scratchpad, origin = this repo):
check behind=1; diverged clone → stopped at download w/ clear
message; dirty tree + dummy .env.local/data/.chrome-profile →
apply stashed the edit, ff-pulled to origin/main, npm install +
real vite build ok, user files byte-identical, stash entry kept;
re-check → up to date; non-git dir → supported:false; preview
walk (banner → modal → steps stream → Cancel flips disabled at
build → restarting message, 0 console errors); ui:build + ui:
typecheck clean. NOT yet seen: a real in-app relaunch (needs the
desktop app + a real behind state — eyes-on). Plan §K + §J BUILT +
VERIFIED 2026-07-14. §K (fill never loses photos): fillListing
step() now ISOLATES every field (throw → { ok:false }, fill
continues; ONLY AutofillAbort/§8.1 still aborts everything) and
TIME-CAPS it (grailed-selectors.json fill.stepTimeoutMs 30s /
photoStepTimeoutMs 180s, cancellable timer); PHOTOS run FIRST
(right after the fresh-form emptiness check, before the fragile
cascade/designer) — plan order matches. Collab designers:
acRectExpr gained a token-set fallback (separators x/×///&/+
dropped; multi-token wants only, exact/substring still win) and
fillAutocomplete retries type the LONGEST collab part ("Stussy x
Nike" → "Stussy") when the previous attempt matched nothing (full
"A x B" strings return ZERO suggestions from Grailed's lookup);
the settle loop now keeps the last read so the final failure lists
what Grailed DID offer. FINDING (live): Grailed's designer
autocomplete has NO collab entries at all ("Nike x", "Stussy
Nike" → only 'Designer not listed') — so a collab correctly fails
CLEAN with the primary brand named in the message for the manual
pick; never auto-commits a value the app didn't pass. Live-
verified: missing-photo throw → title still filled; real photo +
nonsense designer → photos uploaded FIRST + ok, designer failed
clean, run completed 25s; 1ms cap → timeout + run continues (cap
reverted); Carhartt still commits attempt 1; 0 detection signals
throughout. §J (editor stability): App.reloadItems now MERGES —
dirty items keep their in-memory state (DB version takes over
once auto-save clears dirty; deleted items never resurrected);
Editor PINS draft-vs-review per selection (recomputes on item.id
change; review→draft upgrade allowed on the same id so resolving
still flips; !item.content safety-valve → Review). Trigger
investigated: nothing in main.js reprocesses/re-clusters an
existing item in the background (batch creates only NEW items;
review/regenerate/recompute are user-triggered) — the jump was
pure renderer state. Preview-verified: title edit survived 2 real
reloadItems (Home list kept "EDITED-J…"; old code reverted it),
review item still routes to Review, draft to editor, 0 console
errors. ui:typecheck clean. Eyes-on remaining: a real streaming
import while editing (the original tester scenario) + a fill with
photos on a real listing to see photos-first in the checklist.

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
