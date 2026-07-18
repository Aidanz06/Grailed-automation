# 05 — Claude Code Implementation Plan

Copy-pasteable prompts for running the UI improvements through Claude Code, one session/branch per step. Derived from `01`–`04`; respects the repo's CLAUDE.md (commit per feature on a branch, bug = failing test first, done = hand-verified + tests green).

## Setup

The audit docs and mockups are already placed at `docs/ui-improvements/` in this repo. **Do not commit them** — they are private working docs, and the repo's `.gitignore` already excludes them (`docs/*` at .gitignore:25, only SETUP-GUIDE.md ships). Claude Code reads them locally regardless of git tracking. Every prompt below references those paths. Run each step in a **fresh Claude Code session** on a **new branch**, review the diff, verify by hand, then merge before starting the next.

Global guardrails to paste into any session if needed (they're also in CLAUDE.md):
> Never change fill/submit behavior or the safety copy ("never submits", staged category confirm, blocked-fill card). Selectors stay in grailed-selectors.json. Verify by hand before calling anything done.

---

## Step 0 — Test harness (branch `ui-tests`)

```
Read docs/ui-improvements/04-implementation-plan.md Step 0.1.
Set up Vitest + @testing-library/react + jsdom for ui/src (devDependencies; script "ui:test").
Write unit tests for ui/src/lib/readiness.ts, quality.ts, shortcuts.ts, utils.ts (pure functions —
cover triageSort banding, readiness blockers, quality score/boosts, matchShortcut typing/widget guards,
formatWhen, errorMessage, primaryBrand/isCollabBrand).
Add ONE mock-mode smoke test that renders <App /> (ui/src/lib/api.ts already mocks when Electron is absent)
and asserts the Home header renders. Keep component testing at smoke level only.
Wire ui:test into the existing test flow without touching pipeline tests.
Done = npm run ui:test green, npm run ui:typecheck green, npm test still green.
```

## Step 1 — Quick wins, one branch each

**1.1 `money()` (branch `shared-money`)**
```
Per docs/ui-improvements/04-implementation-plan.md Step 1.1 and 03-removal-manifest.md R3:
add money(n) to ui/src/lib/utils.ts using toLocaleString('en-US') ("$1,200"; null/undefined → "—"),
with a unit test. Replace the four identical local consts in Home.tsx, TriageBoard.tsx, DraftEditor.tsx,
PricePanel.tsx. No other changes. Verify: typecheck, ui:test, then run npm run ui:dev and check prices
on the Home board, list rows, DraftEditor price echo, and PricePanel.
```

**1.2 Dead code (branch `remove-dead-primitives`)**
```
Per 03-removal-manifest.md R1/R2 (proven zero imports): delete ui/src/components/ui/card.tsx and
ui/src/components/ui/separator.tsx, remove @radix-ui/react-separator from package.json, run npm install
to update the lockfile. Verify npm run ui:build and ui:typecheck pass. Nothing else.
```

**1.3 Renames + status map (branch `status-map-rename`)**
```
Per 04-implementation-plan.md Step 1.3: (a) rename the FIELD_LABEL className const in DraftEditor.tsx:39
to FIELD_LABEL_CLS (file-local). (b) Create ui/src/lib/statusLabels.ts exporting the ItemStatus→word map
currently at Sidebar.tsx:12 (STATUS_LABEL); use it in Sidebar and CommandPalette (replacing STATUS_WORD at
CommandPalette.tsx:34). Do NOT touch FillChangesCard.tsx's STATUS_WORD — it maps fill-run statuses, a
different domain (manifest R6). Verify: typecheck; sidebar badges and palette status words unchanged on screen.
```

**1.4 Tag dedupe (branch `tag-dedupe`)**
```
Per Step 1.4 and manifest U1: in ui/src/components/TagEditor.tsx, make adding a tag a silent no-op when the
tag already exists case-insensitively (mirror BulkActionBar.tsx:83-90). KEEP key={tag + i} — stored items may
already contain duplicates. Verify by hand in ui:dev: adding a duplicate tag does nothing; removing still works.
```

**1.5 Import-progress weighting (branch `shared-import-progress`)**
```
Per Step 1.5 and manifest R5/U7: create ui/src/lib/importProgress.ts exporting the stage→percent mapping,
adopting ImportScreen.tsx:136-165's numbers as canonical. Use it in both ImportScreen.tsx and
BatchProgressBar.tsx so the two bars can never disagree. PRESERVE each bar's current rendering style:
ImportScreen keeps the slow creep during 'analyzing'; BatchProgressBar keeps indeterminate for 'analyzing'.
Unit-test the mapping. Verify in ui:dev mock import: both bars show the same percent per stage.
```

**1.6 Toast stack (branch `toast-stack`)**
```
Per Step 1.6, manifest R4, and the mockup docs/ui-improvements/mockups/toast-notifications.html:
replace App.tsx's single toastMsg string with a queue (max 3, FIFO eviction). Each toast: own timeout
(keep the length-scaled duration logic from App.tsx:172), a ✕ dismiss button, same card styling as today.
Container gets aria-live="polite" role="status". CRITICAL: the toast prop contract (msg: string) => void
threaded into 15 components must not change — only App's implementation. Extract a ToastStack component.
Unit-test the queue (add/expire/cap/dismiss). Verify by hand: trigger two toasts quickly in mock mode; both
visible, individually dismissible.
```

## Step 2 — Shared components, one branch each (after Stage 1 merges)

**2.1 CoverThumb (branch `cover-thumb`)**
```
Per Step 2.1 and manifest R9: create ui/src/components/CoverThumb.tsx encapsulating the tinted-box +
<img onError → hide> pattern, with size via className, children support (photo-count badges overlay), and
fallback background bg-muted when no tint is provided. Replace the 7 inline copies: Home.tsx (Thumb),
Sidebar.tsx:155-179, TriageBoard.tsx:209-235, ConfirmScreen.tsx:174-195, ConfirmCard.tsx:79-90,
CommandPalette.tsx:142-156. Do NOT touch PhotoRow's PhotoTile, and do NOT change tint:'#333' in
lib/api.ts:576 (data value — manifest U5, owner decision pending). Verify all six sites look identical in
dark mode and the fallback follows the theme in light mode.
```

**2.2 TwoStepDelete + SaveChip (branch `shared-delete-savechip`)**
```
Per Step 2.2 and manifest R10: extract a TwoStepDelete component replacing RowDelete (Home.tsx:47-73) and
CardDelete (TriageBoard.tsx:47-74) via a layout variant prop. Must preserve: arm→"Sure?"→confirm, 3.5s
auto-disarm, stopPropagation in the card-overlay variant, the exact aria-labels and title copy. Extract a
SaveChip for the duplicate save-state chips (DraftEditor.tsx:614-625, ConfirmScreen.tsx:144-153; the "ago"
label is a prop — ConfirmScreen omits it). Unit-test the arm/disarm timer. Hand-verify deletes in both Home
views and the board, and save chips in editor + confirm pass.
```

**2.3 CategorySelect (branch `category-select-grouped`)**
```
Per Step 2.3, manifest R11, and mockups/category-picker-grouped.html: add SelectLabel + SelectGroup usage to
ui/src/components/ui/select.tsx (SelectLabel re-export from Radix; match upstream shadcn styling). Create
CategorySelect.tsx: takes fillOptions.categoryTree, renders departments as group labels with category items,
value stays the "Dept||Cat" string. Replace the duplicated flat catPairs pickers in DraftEditor.tsx
(279-281, 879-905) and ConfirmCard.tsx (69, 218-249). SAFETY: the staged Confirm gate is untouched — the
Confirm buttons and grailed_department/category writes stay in the callers; picking alone must never set
attributes. Hand-verify the full suggest→confirm→change→clear cycle in both the editor and the confirm pass.
```

**2.4 Error boundaries (branch `error-boundary`)**
```
Per Step 2.4 and mockups/error-boundary-fallback.html: add ui/src/components/ErrorBoundary.tsx (class
component). Wrap (a) the app root and (b) the Editor pane in App.tsx. Fallback: left-accent destructive
callout showing the real error message (use errorMessage from lib/utils — the packaged app has no console,
see lib/utils.ts:40-44), buttons: "Reload this screen" (remount via key bump), "Copy error", "Back to Home".
Copy must honestly note that edits from the last ~1s may not have auto-saved. Still console.error the error.
Verify with a temporary throw inside DraftEditor in ui:dev (remove it before commit).
```

## Step 3 — Modal + typography (sequenced)

**3.1 Shared Modal (branch `modal-a11y` — one commit per migrated modal)**
```
Per Step 3.1 and manifest R8 (READ THE TABLE — the six modals have different close behaviors that must be
preserved exactly): add @radix-ui/react-dialog and a components/Modal.tsx wrapper with props
closeOnBackdrop, closeOnEscape, dismissDisabled. Standardize scrims to bg-black/50. Migrate one modal per
commit, in order: DefaultsMenu → GuideMenu → Onboarding → StyleEditor → CommandPalette.
Conditions: StyleEditor blocks Escape/backdrop-close while its template is dirty (Escape first cancels an
active rename, per StyleEditor.tsx:180); GuideMenu/Onboarding keep NO backdrop-close (manifest U6 — owner
hasn't approved changing it); CommandPalette keeps its own keydown handling priority; Radix Selects inside
StyleEditor/DefaultsMenu must still open (portal inside dialog). After each commit: keyboard-only
walkthrough — Tab stays trapped, focus returns to the trigger on close, aria-dialog present in devtools.
```

**3.2 Typography tokens (branch `type-tokens`)**
```
Per Step 3.2 and manifest R12: add named fontSize tokens to ui/tailwind.config.cjs and mechanically replace
all text-[Npx] arbitrary values 1:1 — NO visual change (11px→one token, 13px→another, 10px, 9px, 12px, 15px
likewise; keep exact px values). Full inventory is in manifest R12; there is no dynamic class construction.
Add a CI/lint grep that fails on new text-\[\d+px\]. Land as ONE mechanical commit. Verify: typecheck +
screenshot spot-diff of Home, workspace, confirm pass (should be pixel-identical).
```

**3.3 Contrast pass (branch `micro-text-contrast`) — DO NOT MERGE without my screenshot sign-off**
```
Per Step 3.3 and mockups/micro-text-contrast.html: raise all 9-10px text to ≥11px (sites: TriageBoard.tsx:71,
223; PhotoRow.tsx:46; Sidebar.tsx:172; plus the 10px inventory in manifest R12) and remove /60 /70 opacity
modifiers on text-muted-foreground (keep hierarchy via size/weight instead). Both themes. Produce before/after
screenshots of the sidebar, board card, and DraftEditor tier labels for review — stop there and wait.
```

**3.4 Accessible tooltip equivalents, phase 1 (branch `a11y-tooltips`)**
```
Per Step 3.4: zero-visual-change only. Give the DraftEditor Fill button and the PricePanel confidence pill
aria-describedby pointing at visually-hidden text mirroring their title= content. Nothing else — the visible-
text variants (sidebar blocker, quality score) are owner-gated; skip them.
```

## Step 4 — Structural

**4.1 DraftEditor split — three branches, sequential**
```
(a) branch `fill-orchestration-hook`: Per Step 4.1 PR-a and manifest R13: extract useFillOrchestration from
DraftEditor.tsx — all fill state and effects (filling, fillRun, fillBlocked, armed, firstFillPrompt,
fillOutcome, fillChanges, the autoFillRan and fillSignalSeen refs and their effects) plus startFill,
fillListing, recheckChrome, publishAndNext, duplicateItem. Move editsOf to ui/src/lib/edits.ts and update
its two imports (App.tsx:12, DraftEditor) in the same commit. ZERO behavior change. Add hook unit tests:
gate probe→blocked→force, autoFill consume-once, fillSignal skips mount value.
(b) branch `fill-actions-card`: extract FillActionsCard (DraftEditor rail section ~lines 1059-1200),
consuming the hook via props.
(c) branch `draft-form`: extract DraftForm (left column); DraftEditor becomes composition + save logic.
After EACH branch, run the full manual fill matrix from 04-implementation-plan.md Step 4.1 (normal fill,
all three blocked-card states, Recheck, Fill anyway, first-fill prompt via cleared localStorage, changed-only,
fill-everything-again, F key, palette Fill, FillTracker fill-next, publish-and-next, last-item mark-listed).
```

**4.2 Photo-rail sidebar (branch `photo-rail-sidebar`) — only if I confirm I use Dock regularly**
```
Per Step 4.2 and mockups/compact-sidebar-docked.html: below ~1100px the workspace sidebar collapses to a
~116px photo rail — large 4:5 CoverThumb tiles (~96×120px), readiness chip ("ready" or top blocker) over the
photo on a bg-black/55 scrim, brass ring on the selected draft, full title as tooltip. Add a PanelLeft ghost
Button in the workspace header next to "← Home" toggling tailor.sidebarMode ('auto' | 'expanded' | 'compact',
persisted; manual choice overrides the breakpoint; icon reflects state via PanelLeftClose/PanelLeftOpen,
with aria-label). Bulk select is reachable by expanding. Hand-verify at 900px with Dock active, both themes;
J/K and selection unchanged.
```

---

## Order & gates summary

| Order | Step | Gate |
|---|---|---|
| 1 | 0 tests | — |
| 2 | 1.1–1.6 (any order) | — |
| 3 | 2.1–2.4 (any order) | — |
| 4 | 3.1 → 3.2 | — |
| 5 | 3.3 | **my screenshot sign-off** |
| 6 | 3.4 | — |
| 7 | 4.1 a→b→c | full manual fill matrix each |
| 8 | 4.2 | **my confirmation that I use Dock** |

Never fold in the UNCERTAIN items (manifest U1–U7) as deletions — they stay as documented defaults.
