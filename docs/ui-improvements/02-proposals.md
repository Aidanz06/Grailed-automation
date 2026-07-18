# 02 — Proposals

Each proposal references the problems in `01-ui-audit.md` (P-numbers). Mockups live in `mockups/`; "before" panels are translated from the actual shipped classes, not idealized. Verdicts: **recommend** / **recommend-with-conditions** / **do-not-recommend**.

---

## (a) Quick wins

### QW-1 — Shared `money()` with locale formatting
Move the 4 identical `money()` definitions (P10: `Home.tsx:16`, `TriageBoard.tsx:20`, `DraftEditor.tsx:23`, `PricePanel.tsx:9`) into `lib/utils.ts`, formatted with `toLocaleString('en-US')` → "$1,200". Mockup: [mockups/visual-polish.html](mockups/visual-polish.html).

| Pros | Cons |
|---|---|
| One source; readability of 4-digit prices (common on Grailed); trivial diff | Any place that *parses* the displayed string would break — verified none do (the editable price inputs bind to `range.median` directly, never to `money()` output); minor visual churn ("$1200"→"$1,200") |

**Verdict: recommend.** Zero-risk consolidation; the formatting change is strictly clearer.

### QW-2 — Delete dead primitives: `ui/card.tsx`, `ui/separator.tsx`, `@radix-ui/react-separator`
P17/P18: both files have zero imports (verified). Do **not** alternatively "adopt Card everywhere" — that would churn ~20 call sites for no behavior gain.

| Pros | Cons |
|---|---|
| −67 lines, −1 runtime dependency; removes the trap of two card idioms | If a future shadcn component is added via CLI it may regenerate these files (harmless); needs the Phase-3 proof of non-use (done) |

**Verdict: recommend** (subject to the Removal Manifest, §03).

### QW-3 — Toast stack: dismissible, announced, non-clobbering
P3/P9: replace the single `toastMsg` string with a small queue (max 3), per-toast timeout + ✕, container `aria-live="polite"`, optional success/error accent. Keep the exact card styling. Mockup: [mockups/toast-notifications.html](mockups/toast-notifications.html).

| Pros | Cons |
|---|---|
| Fill summaries and errors can no longer erase each other (real failure mode — fill toasts run 9s while background events fire); screen-reader announcement; user control | Touches the `toast` prop threaded through ~12 components — but only the *App-side implementation* changes if the signature stays `(msg: string) => void`; slight risk of toast pile-up (capped at 3); ~80 new lines |

**Verdict: recommend.** Keep the `(msg: string)` signature so no consumer changes; severity accents only where the caller opts in later.

### QW-4 — TagEditor dedupe
P4: case-insensitive dedupe on add in `TagEditor.tsx` (mirror `BulkActionBar.tsx:83-90`), and drop the `key={tag + i}` workaround once dupes are impossible — **condition:** existing items may already contain duplicate tags, so keep index-keying unless a data migration dedupes stored tags.

| Pros | Cons |
|---|---|
| Consistent with bulk add; prevents duplicate tags reaching the Grailed form | Behavior change (silent ignore vs current append) — needs a tiny toast/no-op affordance decision |

**Verdict: recommend** (silent no-op on duplicate, like BulkActionBar).

### QW-5 — Single source for import-progress weighting
P2: extract the stage→percent mapping used by `ImportScreen.tsx:136-165` and `BatchProgressBar.tsx:17-31` into `lib/importProgress.ts`; the two bars currently disagree (grouping 2 vs 5; preparing formulas differ). Keep ImportScreen's richer variant (creep during `analyzing`) as the shared behavior, with the thin bar allowed to render creep as indeterminate.

| Pros | Cons |
|---|---|
| Two bars can never show different numbers again; fixes today's drift | The thin bar's `analyzing` display changes slightly (indeterminate → creep or stays indeterminate — decide once); small refactor of two working components |

**Verdict: recommend.**

### QW-6 — Rename the `FIELD_LABEL` collision
P16: rename DraftEditor's local className constant (`DraftEditor.tsx:39`) to `FIELD_LABEL_CLS` (or similar). Pure rename, file-local.

**Verdict: recommend.** (No table needed — no cost beyond a one-line diff; the collision has already caused a near-miss risk in FillChangesCard's import.)

### QW-7 — Shared status vocabulary map
P13: move `STATUS_LABEL` (`Sidebar.tsx:12`) to `lib/` (e.g. `lib/statusLabels.ts` or into `types/index.ts` adjacent to `ItemStatus`) and have `CommandPalette.tsx:34` use it.

| Pros | Cons |
|---|---|
| One rename point for user-facing status vocabulary (the "submitted→listed" alignment is already a documented concern, `Sidebar.tsx:15`) | None material |

**Verdict: recommend.**

### QW-8 — Standardize overlay scrims + Escape-to-close
P23 + the cheap half of P5: all six overlays get `bg-black/50`, and Escape closes StyleEditor, DefaultsMenu, GuideMenu, Onboarding (CommandPalette and Updater already handle it). Escape in StyleEditor must first cancel an active rename (existing behavior at `StyleEditor.tsx:180`), then close.

| Pros | Cons |
|---|---|
| Uniform feel; the most-missed keyboard affordance fixed in ~20 lines | Escape-closing StyleEditor with unsaved template edits could lose work → **condition:** ignore Escape (or confirm) when `dirty` is true |

**Verdict: recommend-with-conditions** (guard dirty StyleEditor).

---

## (b) Medium changes

### M-1 — Shared `Modal` wrapper (dialog semantics, focus trap, restore)
P5: one component providing `role="dialog"`, `aria-modal`, labelled-by wiring, focus trap, focus restore, scrim + Escape (subsumes QW-8's overlay half), adopted by StyleEditor, DefaultsMenu, GuideMenu, Onboarding, CommandPalette. Updater already has the semantics and can adopt last. No visual change intended.

| Pros | Cons |
|---|---|
| Fixes the largest a11y gap in the app in one place; future modals get it free; removes 5 hand-rolled backdrop implementations | Focus traps are easy to get subtly wrong (Radix Select portals *inside* modals must stay operable — StyleEditor and DefaultsMenu both contain Selects and the trap must not fight the portal); CommandPalette has bespoke key handling that must keep priority; regression risk is real though contained; ~150 new lines |
| | Hand-rolling a trap vs adding `@radix-ui/react-dialog` (~10 kB) is a genuine choice — Radix is battle-tested and already a dependency family |

**Verdict: recommend-with-conditions.** Use `@radix-ui/react-dialog` as the base (consistent with the existing Radix usage) rather than a hand-rolled trap; migrate one modal per commit; CommandPalette last (most bespoke).

### M-2 — `CoverThumb` shared component + token fallback
P12/P22: one component for the tinted-box + `<img onError>` pattern (7 duplicates), with size variants, and the `'#333'` fallback replaced by `bg-muted` (theme-aware; fixes the light-theme near-black chip). `PhotoTile` keeps its own richer implementation. Mockup: [mockups/visual-polish.html](mockups/visual-polish.html).

| Pros | Cons |
|---|---|
| −~90 duplicated lines; consistent fallback behavior; light-theme fix; single place to add e.g. lazy-loading later | Seven call sites touched (each small); the `tint` prop still passes through (mock data paints real tints — behavior kept); slight visual change in light theme only |

**Verdict: recommend.**

### M-3 — Named typography micro-scale
P21: add Tailwind `fontSize` tokens — `2xs: 10px`, `xs+: 11px` (name TBD), `sm-: 13px` — and codemod the 86 arbitrary values **1:1, no visual change**, leaving 9px→10px and 15px→sm to the contrast pass (M-4) to decide. Enforce with a lint grep in CI (`text-\[\d+px\]`).

| Pros | Cons |
|---|---|
| A named scale ends the "11 or 12?" per-call-site decision; makes M-4 reviewable; zero visual churn if mapped 1:1 | Naming is bikesheddy; a codemod touching ~30 files inflates diffs and `git blame`; without the CI grep the arbitrary values will creep back |

**Verdict: recommend-with-conditions.** Only worth doing with the CI grep; land as one mechanical commit (easy to review with `--word-diff`), separate from any visual change.

### M-4 — Micro-text contrast pass
P8: floor text at 11px, remove `/60` `/70` opacity modifiers on muted text, keep hierarchy via size/weight. Mockup: [mockups/micro-text-contrast.html](mockups/micro-text-contrast.html).

| Pros | Cons |
|---|---|
| WCAG AA on the sidebar blockers, board card metadata, photo-count badges — the highest-read micro-text in the app; helps the owner's actual users (resale sellers squinting at counts) | Deliberate visual change to a theme the owner hand-tuned ("studio-blend", owner-directed 2026-07-04) — densities shift slightly on the board and sidebar; needs owner eyes on the result before merge |

**Verdict: recommend-with-conditions.** Ship behind a single commit with before/after screenshots for owner sign-off; do it *after* M-3 so the diff is readable.

### M-5 — Error boundary at App root + Editor pane
P1: an `ErrorBoundary` wrapping (a) the whole app and (b) the Editor pane specifically (most state-dense area), rendering the fallback in [mockups/error-boundary-fallback.html](mockups/error-boundary-fallback.html): real error text (per the app's own `errorMessage` doctrine), Copy error, Reload screen, Back to Home. "Reload" = remount via key bump; drafts are safe because saves are debounced to SQLite.

| Pros | Cons |
|---|---|
| Converts white-screen-with-no-console into a recoverable state with a reportable message; aligns with the packaged-app constraint documented in `lib/utils.ts:40-44` | Class component (boundaries can't be hooks) in a function-component codebase; fallback copy must be honest about what's saved (debounced edits <800ms old may be lost — say so); small risk the boundary masks errors during dev (mitigate: rethrow in dev / log loudly) |

**Verdict: recommend.**

### M-6 — Extract `TwoStepDelete` + `SaveChip`
P11/P14: one two-step delete component (props: layout variant for row vs card-overlay) replacing `RowDelete`/`CardDelete`; one save-state chip replacing the DraftEditor/ConfirmScreen twins.

| Pros | Cons |
|---|---|
| Removes the most drift-prone duplication (destructive-action UX must stay identical everywhere); −~80 lines | The two deletes have real markup differences (overlay + group-hover vs inline block) — the shared component needs a variant prop, mild abstraction cost; SaveChip's ConfirmScreen version omits the "ago" label (keep that as a prop) |

**Verdict: recommend.**

### M-7 — Grouped category picker
P27: render the existing category Select with `SelectGroup`/`SelectLabel` department headers, in both DraftEditor and ConfirmCard — ideally as a shared `CategorySelect` that also kills the duplicated `catPairs` flattening (P15). Value stays `"Dept||Cat"`; the staged-Confirm gate is untouched. Mockup: [mockups/category-picker-grouped.html](mockups/category-picker-grouped.html).

| Pros | Cons |
|---|---|
| Faster scanning of ~50 rows; removes duplicated picker logic in two files; uses an export that already exists (`SelectItem` typeahead still works within groups) | Radix typeahead matches item text — after grouping, typing "T" matches "Tops" in *either* department (before, "M" jumped to Menswear rows); minor muscle-memory change; needs `SelectLabel` added to `ui/select.tsx` (upstream shadcn version has it) |

**Verdict: recommend.**

### M-8 — Critical `title=` tooltips get accessible equivalents
P7: for the four highest-stakes cases only (sidebar blocker detail, quality score meaning, Fill button explanation, comps confidence detail), add visible or focus-accessible text (e.g. `aria-describedby` + a focus-visible popover, or promote the text into the existing cards). NOT an app-wide tooltip system.

| Pros | Cons |
|---|---|
| Keyboard/SR users can reach the app's most important explanations; scoped to 4 sites | Each site needs an individual design decision (where does the text live without cluttering the owner's deliberately quiet hierarchy?); risk of visual noise in a UI that was explicitly de-loudened (§F tiers); partially subjective payoff for a currently single-user app |

**Verdict: recommend-with-conditions.** Do the two zero-visual-cost ones first (`aria-describedby` on Fill button + confidence pill); the two that add visible text need owner sign-off.

---

## (c) Structural changes

### S-1 — Split `DraftEditor.tsx` (1,262 lines) into form + fill orchestration + rail
P24: extract (1) `useFillOrchestration(item, …)` — all fill state (`filling`, `fillRun`, `fillBlocked`, `armed`, `firstFillPrompt`, `fillOutcome`, `fillChanges`, autoFill/fillSignal effects, `startFill`/`fillListing`/`recheckChrome`/`publishAndNext`); (2) `FillActionsCard` — the rail's action section (lines 1059-1200); (3) `DraftForm` — the left column. `DraftEditor` becomes composition + save logic (~300 lines). **No behavior or visual change.**

| Pros | Cons |
|---|---|
| The fill state machine — the app's most safety-critical UI logic — becomes independently readable and testable; future fill changes stop risking form regressions; unlocks unit tests for the gate logic (probe → blocked → force) | Highest regression risk of any proposal: the effects are order- and identity-sensitive (`autoFillRan` ref, `fillSignalSeen` ref, consume-on-mount semantics); the CLAUDE.md bar is "behavior verified by hand" — this needs a full manual fill pass (blocked card, first-fill prompt, changed-only, publish-and-next, F key, palette fill) plus the new smoke tests (S-2) to be worth it; big diff, `git blame` churn |

**Verdict: recommend-with-conditions.** Only after S-2 exists (tests to catch regressions), and as 3 sequential PRs (hook → rail card → form), each hand-verified against the fill flows. Do not combine with any visual change.

### S-2 — Minimal UI test harness (Vitest + Testing Library, mock-mode)
No UI tests exist; every proposal above cites "no safety net" as its main risk. The mock mode in `lib/api.ts` already makes the renderer runnable without Electron. Add: render-App smoke test, readiness/quality unit tests (pure functions), toast queue tests, fill-gate hook tests (after S-1), shortcut matcher tests.

| Pros | Cons |
|---|---|
| Converts CLAUDE.md's "a bug becomes a failing test first" from pipeline-only to UI; makes S-1 and M-1 safe to attempt; pure-lib tests (readiness, shortcuts) are cheap and high-value | New dev dependencies (vitest, @testing-library/react, jsdom); CI time; component tests against Radix portals are fiddly (keep to smoke level); maintenance cost in a fast-moving UI |

**Verdict: recommend.** Scope discipline: libs thoroughly, components smoke-only.

### S-3 — Photo-rail sidebar at docked width
P26: below ~1100px the workspace sidebar collapses to a **~116px photo rail**: large 4:5 photo tiles (~96×120px — *bigger* than the current 64px sidebar thumbs, board-card aspect) so every draft stays instantly recognizable and one click away even while Chrome is docked — the photo is the navigation (owner requirement 2026-07-18). Titles hide; the readiness state ("ready" / top blocker) survives as a compact chip on each tile; selected draft keeps the brass ring; full title on hover. Full sidebar unchanged at normal widths. A **manual toggle button** (PanelLeft icon, ghost style) sits in the workspace header next to "← Home" — the visual seam between sidebar and editor — so compact/expand works at any width; a manual choice overrides the breakpoint and persists (`tailor.sidebarMode`: `auto` / `expanded` / `compact`). Justified by the dock feature itself shrinking the app to its 900px minimum (`ui/main.js:612,642`) — the exact moment the seller is filling. Mockup: [mockups/compact-sidebar-docked.html](mockups/compact-sidebar-docked.html).

| Pros | Cons |
|---|---|
| +~200px for the editor exactly when docked; navigation *improves* while docked (larger photos than the current 64px thumbs); nothing removed (auto-restores); J/K flow unaffected; readiness still visible per tile | New responsive state to maintain; titles and bulk-select checkboxes become one interaction further away at narrow widths (bulk-select requires expanding); blocker chips on photos need care to stay legible over busy images; medium implementation + real design judgment |

**Verdict: recommend-with-conditions.** Build only if the owner actually uses Dock regularly (one question answers it); persist the collapsed state like `tailor.homeView`; blocker chip sits on the existing `bg-black/55` scrim convention (PhotoRow badges) for legibility.

### S-4 — App-wide tooltip system (Radix Tooltip replacing `title=`)
The tempting "fix everything" version of M-8: replace all ~60 `title=` usages.

| Pros | Cons |
|---|---|
| Consistent, styleable, keyboard-triggerable tooltips everywhere | ~60 call sites of churn; +dependency; native `title` is *fine* for the long tail of low-stakes hints in a mouse-first desktop app; huge review burden; visual churn the owner didn't ask for; M-8 captures ~90% of the value at ~5% of the cost |

**Verdict: do-not-recommend** (superseded by M-8).

### S-5 — Replace the Radix ScrollArea `!important` patch
P25: swap `ScrollArea` for native `overflow-y-auto` (+ scrollbar styling) in the sidebar so `index.css:90-92` can be deleted.

| Pros | Cons |
|---|---|
| Removes a patch pinned to Radix private DOM | The patch *works today*, is documented, and applies to all 5 ScrollArea sites — replacing one leaves the hack for the rest, replacing all changes scroll behavior (custom overlay scrollbar → native) across the app for zero user-visible gain; Radix is version-pinned in package.json so silent breakage requires a deliberate upgrade |

**Verdict: do-not-recommend.** Instead: add a one-line comment in `package.json` context (or CHANGELOG note) that upgrading `@radix-ui/react-scroll-area` requires re-verifying the sidebar truncation. Revisit only on a Radix upgrade.

### S-6 — Home header regrouping
P29: 8 controls in the Home header. Tempting to fold Defaults/Guide/theme into a single menu.

| Pros | Cons |
|---|---|
| Less crowding at 900px | Every control is currently one click away and the owner placed them; a menu adds a click to frequently-used items (Defaults, Guide); at 900px nothing actually breaks (verified: no overflow at min width with typical labels — the Confirm-drafts button only appears when `unready > 0`, worst case is mild crowding); churn without demonstrated pain |

**Verdict: do-not-recommend now.** Cheap compromise if crowding is ever observed: add `flex-wrap` to the header (1-line diff).

---

## Summary table

| ID | Change | Group | Verdict |
|---|---|---|---|
| QW-1 | Shared `money()` + locale format | quick | recommend |
| QW-2 | Delete dead card/separator primitives | quick | recommend |
| QW-3 | Toast stack (dismiss, aria-live) | quick | recommend |
| QW-4 | TagEditor dedupe | quick | recommend |
| QW-5 | Shared import-progress weighting | quick | recommend |
| QW-6 | `FIELD_LABEL` rename | quick | recommend |
| QW-7 | Shared status-label map | quick | recommend |
| QW-8 | Scrim + Escape standardization | quick | recommend-with-conditions |
| M-1 | Shared Modal (dialog a11y) | medium | recommend-with-conditions |
| M-2 | `CoverThumb` + token fallback | medium | recommend |
| M-3 | Typography micro-scale tokens | medium | recommend-with-conditions |
| M-4 | Micro-text contrast pass | medium | recommend-with-conditions |
| M-5 | Error boundaries | medium | recommend |
| M-6 | `TwoStepDelete` + `SaveChip` extraction | medium | recommend |
| M-7 | Grouped category picker (+ shared `CategorySelect`) | medium | recommend |
| M-8 | Accessible equivalents for 4 critical tooltips | medium | recommend-with-conditions |
| S-1 | Split DraftEditor | structural | recommend-with-conditions |
| S-2 | UI test harness | structural | recommend |
| S-3 | Photo-rail sidebar when docked (+ header expand/compact toggle) | structural | recommend-with-conditions |
| S-4 | App-wide tooltip system | structural | **do-not-recommend** |
| S-5 | Replace ScrollArea `!important` patch | structural | **do-not-recommend** |
| S-6 | Home header regrouping | structural | **do-not-recommend** |
