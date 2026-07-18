# 01 — UI Audit: Tailor Studio (`ui/`)

Audit date: 2026-07-18. Every claim below was verified against the actual source; file:line references are to the current working tree (HEAD `b5694d1`).

---

## 1. Frontend map

| Layer | What's used | Where |
|---|---|---|
| Shell | Electron 43 (`ui/main.js` main process, `ui/preload.js` contextBridge → `window.tailor`) | `package.json`, `ui/main.js` |
| Renderer | React 19 + TypeScript 6, built by Vite 8 | `ui/src/main.tsx`, `ui/vite.config.ts` |
| Styling | Tailwind CSS 3.4 (`darkMode: ['class']`) + `tailwindcss-animate`; one global stylesheet `ui/src/index.css` | `ui/tailwind.config.cjs` |
| Component kit | shadcn/ui-style primitives (hand-vendored, `ui/components.json` present) over Radix (`react-select`, `react-scroll-area`, `react-separator`, `react-slot`); `class-variance-authority` + `clsx` + `tailwind-merge` (`cn()` in `ui/src/lib/utils.ts:5`) | `ui/src/components/ui/*` |
| Icons | `lucide-react` | throughout |
| Fonts | Self-hosted via `@fontsource`: Space Grotesk (UI sans), JetBrains Mono (data/numbers), Instrument Serif (display voice — wordmark + big price only) | `ui/src/main.tsx:6-12`, `tailwind.config.cjs:28-32` |
| Theming | HSL CSS variables; `.dark` (default) = "studio" deep-cool dark, `:root` = warm-paper light. Pre-paint theme script avoids flash | `ui/src/index.css:13-65`, `ui/index.html:7-15` |
| Routing/state | None — `App.tsx` holds a 3-value `view` state (`home` / `workspace` / `confirm`) plus overlays; no router, no state library. IPC via `ui/src/lib/api.ts` (1,143 lines) with a full mock mode for `ui:dev` | `ui/src/App.tsx:25` |
| Testing | **No UI tests exist.** `npm test` runs the pipeline-only offline suite (`pipeline/*.test.js`); the only UI gate is `npm run ui:typecheck`. No `data-testid` anywhere (verified by grep) | `package.json:28-34` |

Total renderer size: ~9,700 lines across 40 files. Largest: `DraftEditor.tsx` (1,262), `lib/api.ts` (1,143), `App.tsx` (610).

---

## 2. Component inventory

### 2.1 Screens (routed by `App.tsx` `view` state)

| Screen | File (lines) | Purpose | Reached from |
|---|---|---|---|
| Home | `components/Home.tsx` (371) | Landing surface: `TriageBoard` (default) or classic `HomeLists` (toggle, persisted `tailor.homeView`), albums list, `GettingStarted` / `ChromeNotifier`, header with Defaults/Guide/ThemeToggle/New batch | `view === 'home'` (`App.tsx:389`) |
| Workspace | inline in `App.tsx:437-559` | Header (back, Confirm drafts, ?, ChromeStatusChip, Dock, ThemeToggle) + `FillTracker` strip + `grid-cols-[320px_1fr]` of `Sidebar` + `Editor` | `view === 'workspace'` |
| Confirm pass | `components/ConfirmScreen.tsx` (237) | Card-per-gap keyboard queue over unready drafts; renders `ConfirmCard` | `view === 'confirm'` (`App.tsx:423`) |

### 2.2 Workspace editor surfaces (switched by `Editor.tsx`, 92 lines)

| Component | File (lines) | Purpose |
|---|---|---|
| ImportScreen | `ImportScreen.tsx` (360) | Folder pick, weighted progress + step checklist, streamed-draft card, post-import summary |
| ReviewScreen | `ReviewScreen.tsx` (184) | Uncertain photo group resolution: confirm / split / assign |
| DraftEditor | `DraftEditor.tsx` (1,262) | The main form (photos, title, description, tags, tier-1 band, category cascade, more-details) **plus** the entire fill orchestration state machine (gate probe, blocked card, first-fill prompt, changed-only fill, publish-and-next) and right rail composition |

### 2.3 Shared feature components

| Component | File (lines) | Used by (import sites) |
|---|---|---|
| Sidebar | `Sidebar.tsx` (226) | App (1) |
| TriageBoard (+ `FLAG_LABELS`, `reviewReason`) | `TriageBoard.tsx` (290) | Home (1) |
| ConfirmCard | `ConfirmCard.tsx` (414) | ConfirmScreen (1) |
| PricePanel | `PricePanel.tsx` (344) | DraftEditor (1) |
| PhotoRow / PhotoTile | `PhotoRow.tsx` (168) | DraftEditor (1) |
| ListingChecklist | `ListingChecklist.tsx` (66) | DraftEditor (1) |
| FillProgressCard (+ `applyFillProgress`, `emptyFillRun`, `FIELD_LABEL` map) | `FillProgressCard.tsx` (138) | DraftEditor (1); FillChangesCard imports the map |
| FillChangesCard | `FillChangesCard.tsx` (101) | DraftEditor (1) |
| FillTracker | `FillTracker.tsx` (85) | App (1) |
| BatchProgressBar | `BatchProgressBar.tsx` (83) | App (1) |
| BulkActionBar | `BulkActionBar.tsx` (189) | Sidebar (1) |
| ChromeStatusChip (+ hooks `useChromeStatus`, `useLaunchChrome`, `useOpenSellTab`) | `ChromeStatusChip.tsx` (132) | App (chip); hooks reused by ChromeNotifier, GettingStarted, DraftEditor (4 files) |
| ChromeNotifier | `ChromeNotifier.tsx` (81) | Home (1) |
| GettingStarted | `GettingStarted.tsx` (107) | Home (1) |
| Onboarding (+ `HowItWorksSteps`, `TrustContract`, `ONBOARDED_KEY`) | `Onboarding.tsx` (117) | App; sub-components reused by GuideMenu |
| GuideMenu | `GuideMenu.tsx` (176) | App (1) |
| CommandPalette | `CommandPalette.tsx` (170) | App (1) |
| StyleEditor | `StyleEditor.tsx` (265) | App (1, global modal) |
| ChipTemplateEditor | `ChipTemplateEditor.tsx` (231) | StyleEditor (1) |
| DefaultsMenu | `DefaultsMenu.tsx` (154) | Home (1) |
| DetailPanel | `DetailPanel.tsx` (34) | DraftEditor (1) |
| TagEditor | `TagEditor.tsx` (40) | DraftEditor (1) |
| ConditionChips (+ `CONDITIONS`, `PICKABLE_CONDITIONS`) | `ConditionChips.tsx` (43) | DraftEditor, ConfirmCard; CONDITIONS also BulkActionBar (3) |
| ShortcutHelp (`ShortcutRows`) | `ShortcutHelp.tsx` (32) | GuideMenu (1) |
| ThemeToggle | `ThemeToggle.tsx` (30) | Home, App workspace header, ConfirmScreen (3) |
| Updater (`useUpdater`, `UpdateBanner`, `UpdateModal`, `CheckUpdatesButton`) | `Updater.tsx` (328) | App, Home (2) |
| motion primitives (`AnimatedCheck`, `LiveDot`, `PendingDot`, `ProgressBar`, `PhotoShuffler`) | `motion.tsx` (83) | 6 files; usage counts: AnimatedCheck ×7, PendingDot ×5, ProgressBar ×4, LiveDot ×3, PhotoShuffler ×1 |

### 2.4 UI primitives (`components/ui/`)

| Primitive | Variants/props | Import sites | Status |
|---|---|---|---|
| Button | variant: default/destructive/outline/secondary/ghost/link; size: default/sm/lg/icon; `asChild` | 19 files, ~52 usages | healthy |
| Input | plain wrapper | 7 files, 16 usages | healthy |
| Select (Trigger/Content/Item/Value + Group, ScrollUp/Down) | Radix wrapper | 7 files | healthy (`SelectGroup` re-exported, never used) |
| Badge | variant: default/secondary/destructive/outline | 4 files, 5 usages | healthy |
| ScrollArea | Radix wrapper (+ `ScrollBar` export, unused externally) | 5 files, 10 usages | healthy |
| Textarea | plain wrapper | 2 files | healthy |
| **Card** (+ Header/Title/Description/Content/Footer) | — | **0 imports anywhere** | **dead file** (`ui/card.tsx`, 44 lines). All "cards" in the app are hand-rolled `rounded-xl border bg-card p-4` divs |
| **Separator** | — | **0 imports anywhere** | **dead file** (`ui/separator.tsx`, 23 lines) + its dependency `@radix-ui/react-separator` in `package.json:56` |

### 2.5 Shared libs feeding the UI

`lib/readiness.ts` (buildRows/readiness/triageSort/GRAILED_PHOTO_LIMIT — single source for checklist, sidebar chips, board, confirm queue), `lib/quality.ts` (score/state), `lib/shortcuts.ts` (single-source keyboard table, rendered by ShortcutHelp), `lib/description.ts`, `lib/grailedCategory.ts`, `lib/utils.ts` (`cn`, `formatWhen`, `agoLabel`, `errorMessage`, `primaryBrand`, `isCollabBrand`), `lib/api.ts` (IPC + mock).

---

## 3. Current conventions (must be respected or explicitly migrated)

1. **Colors only via semantic tokens.** All colors are `hsl(var(--…))` Tailwind tokens (`background/foreground/card/primary/secondary/muted/accent/destructive/warning/success/border/input/ring`). The champagne-brass `--primary` is deliberate ("never the stock shadcn blue", `index.css:5-11`). Exceptions are the problems listed in §4 (P12).
2. **Typography roles.** `font-display` (Instrument Serif) is *reserved* for the wordmark and the big price — enforced by comment at `ConfirmScreen.tsx:133-135`; `font-mono` for data (prices, counts, dates, tabular-nums); Space Grotesk for everything else. Micro-labels are uppercase + `tracking-wide`/`wider`, usually `text-[10px]`–`text-xs` muted.
3. **Spacing/radius.** Cards: `rounded-xl border bg-card p-4` (rail) or `rounded-lg … p-3` (rows); section gaps `mb-5`/`space-y-4`; radius from `--radius` (0.625rem). Informal but fairly consistent.
4. **Left-accent callouts.** Warning/notice boxes use `border-l-[3px] border-l-warning|primary|success bg-…/10` (DraftEditor ×4, ImportScreen, PhotoRow, Onboarding).
5. **Two-step destructive actions.** Delete = arm ("Sure?") → confirm, auto-disarm 3.5 s (`Home.tsx:47`, `TriageBoard.tsx:47`); Mark-listed = inline confirm box (`DraftEditor.tsx:1180`).
6. **Trust copy.** "never submits", "login is always manual", "nothing touches Grailed" phrasing appears verbatim across surfaces; several components note they share exact copy sources to prevent drift (Onboarding ↔ Guide, shortcuts table).
7. **Keyboard single-source.** All bindings live in `lib/shortcuts.ts`; both handlers (App, ConfirmScreen) and the Guide read the same table.
8. **`title=` tooltips everywhere** as the explanation channel (dozens of instances).
9. **localStorage keys** namespaced `tailor.*` (`tailor.dockChrome`, `tailor.homeView`, `tailor.onboarded`, `tailor.firstFillConfirmed`) plus bare `theme`; every access is try/catch-wrapped.
10. **Icon buttons carry `aria-label`** in most places (theme toggle, deletes, guide, view toggle); `role="radiogroup"` on ConditionChips; `role="status" aria-live` on BatchProgressBar.
11. **Motion.** All animation is CSS in `index.css` utilities, used through `motion.tsx`, and disabled wholesale under `prefers-reduced-motion` (`index.css:188-200`).
12. **Responsive**: desktop-only Electron app, min window 900px (`ui/main.js:612`). The only breakpoints used are `md:` (field grids) and `lg:` (DraftEditor rail stacks below `lg`; FillTracker album name hides below `lg`).

---

## 4. Problems found

Ordered roughly by severity within each group. Every item verified in source.

### A. Correctness / robustness

- **P1 — No React error boundary anywhere.** A render error white-screens the app. This is aggravated by the app's own documented constraint that *the packaged app has no console* (`lib/utils.ts:40-44` — "every failure toast must carry the real message — 'see console' is a dead end"). Verified: no `ErrorBoundary`/`componentDidCatch`/`getDerivedStateFromError` in `ui/src`.
- **P2 — Progress-weighting logic duplicated and already drifted.** `ImportScreen.tsx:136-165` and `BatchProgressBar.tsx:17-31` implement the same stage→percent mapping independently; they disagree today (`grouping` = 2 vs 5; `preparing` = `2+13·frac` vs `15·frac`; `analyzing` = 50-creep vs indeterminate). The two bars can show different numbers for the same event.
- **P3 — Toast system is a single replaceable string** (`App.tsx:62, 169-174, 603-607`). A second toast silently overwrites the first mid-read (e.g., a fill summary replaced by an album-toggle failure); no `role="status"`/`aria-live`, no manual dismiss, and important fill outcomes route through it (partially mitigated by the persistent fill banner).
- **P4 — TagEditor allows duplicate tags** (`TagEditor.tsx:33-38` appends without dedupe; `key={tag + i}` at line 15 exists *because* duplicates can occur), while BulkActionBar's add-tag dedupes case-insensitively (`BulkActionBar.tsx:83-90`). Same action, two behaviors.

### B. Accessibility

- **P5 — Five of six overlays are not accessible dialogs.** Only the Updater modal has `role="dialog" aria-modal` (`Updater.tsx:258`). `StyleEditor.tsx:141`, `DefaultsMenu.tsx:79`, `GuideMenu.tsx:118`, `Onboarding.tsx:96`, `CommandPalette.tsx:103` are plain fixed divs: no dialog role, no focus trap, no focus restore, and no Escape-to-close except CommandPalette (StyleEditor's Escape at line 180 only cancels rename). Background stays keyboard-reachable behind every one of them.
- **P6 — CommandPalette lacks combobox/listbox semantics** (`CommandPalette.tsx:110-119`): no `role="combobox"`, `aria-expanded`, `aria-activedescendant`, or `role="option"` rows — arrow-key selection is invisible to screen readers.
- **P7 — `title=` attributes are the sole channel for critical information** (keyboard- and touch-inaccessible, and unreliable for screen readers): e.g. the sidebar readiness explanation (`Sidebar.tsx:194-203`), quality score meaning (`TriageBoard.tsx:253`), what the Fill button will do (`DraftEditor.tsx:1062-1068`), comps confidence detail (`PricePanel.tsx:167`).
- **P8 — Probable contrast failures on micro-text**: `text-[10px] uppercase` in `text-muted-foreground/70` (`DraftEditor.tsx:610`), `text-muted-foreground/60` (`Sidebar.tsx`, `Home.tsx:328`), 9px photo-count badges on photos (`TriageBoard.tsx:223`, `Sidebar.tsx:172`). Muted-on-background at 60-70% opacity at 9-10px is very likely below WCAG AA (4.5:1).
- **P9 — Toast not announced** (see P3) and `FillTracker`/save-state chips likewise have no live-region semantics; state changes are visual-only.

### C. Duplication (drift risk)

- **P10 — `money()` defined 4×** identically: `Home.tsx:16`, `TriageBoard.tsx:20`, `DraftEditor.tsx:23`, `PricePanel.tsx:9`. Also no thousands separator (`'$' + n` → "$1200").
- **P11 — Two-step delete duplicated**: `RowDelete` (`Home.tsx:47-73`) vs `CardDelete` (`TriageBoard.tsx:47-74`) — same arm/timeout/confirm logic, same 3500 ms constant, different markup.
- **P12 — Cover-image pattern duplicated ×7**: tinted box + optional `<img>` + `onError → display:'none'` appears in `Home.tsx` (Thumb), `Sidebar.tsx:155-168`, `TriageBoard.tsx:209-219`, `ConfirmScreen.tsx:178-190`, `ConfirmCard.tsx:79-90`, `CommandPalette.tsx:142-156`, `PhotoRow.tsx:34-43` — each with the hardcoded `'#333'` fallback (see P15).
- **P13 — Status vocabulary maps duplicated**: `STATUS_LABEL` (`Sidebar.tsx:12-17`) vs `STATUS_WORD` (`CommandPalette.tsx:34-39`) — both map `submitted → 'listed'` etc. A future status rename must be made twice.
- **P14 — Save-state chip duplicated**: `DraftEditor.tsx:614-625` vs `ConfirmScreen.tsx:144-153` (same 'idle'/'saving'/'saved' chip, slightly different classes).
- **P15 — Category cascade picker duplicated**: flattened `catPairs` + `Dept › Cat` Select + staged Confirm implemented in both `DraftEditor.tsx:279-300, 879-905` and `ConfirmCard.tsx:69, 204-250`.
- **P16 — Naming collision**: `FIELD_LABEL` is a *className string* in `DraftEditor.tsx:39` and a *Record of display labels* in `FillProgressCard.tsx:44` — two unrelated exports with the same name in sibling files.

### D. Dead code / styles

- **P17 — `components/ui/card.tsx` (44 lines): zero imports.** Every card in the app is a hand-rolled div. Either adopt it or remove it.
- **P18 — `components/ui/separator.tsx`: zero imports**, plus its runtime dependency `@radix-ui/react-separator` (`package.json:56`).
- **P19 — Unused exports**: `SelectGroup`, `SelectScrollUpButton`, `SelectScrollDownButton` (`ui/select.tsx:145-152`) and `ScrollBar` (`ui/scroll-area.tsx`) are exported but unused outside their files; `badgeVariants`/`buttonVariants` exported, never imported elsewhere (verified by grep).
- **P20 — Legacy `descProfile`** field still on `Item` (`types/index.ts:187`) with three comments saying it's ignored — a documented-dead data path.

### E. Consistency / design-token gaps

- **P21 — 86 arbitrary pixel font sizes** across six values: `text-[11px]` ×43, `text-[13px]` ×24, `text-[10px]` ×13, `text-[9px]` ×4, `text-[15px]` ×1, `text-[12px]` ×1 — interleaved with Tailwind's `text-xs` (12px) and `text-sm` (14px). Six de-facto sizes with no named scale; `text-[12px]` vs `text-xs` and `text-[13px]` vs `text-sm` are near-duplicates chosen ad hoc.
- **P22 — Hardcoded hex colors outside the token system**: `'#333'` thumbnail fallback ×7 files (renders as a dark gray chip *in the light theme too*), `PALETTE` of 6 hex tints (`PhotoRow.tsx:6`), `bg-black/40|50|55|60` overlay/scrim shades varying per file (40, 50, 55, 60 all in use).
- **P23 — Overlay scrim inconsistency**: modal backdrops are `bg-black/40` (StyleEditor, DefaultsMenu, CommandPalette) vs `bg-black/50` (GuideMenu, Onboarding, Updater); close affordances differ (X button only vs backdrop-click only vs both).

### F. Structure / maintainability

- **P24 — `DraftEditor.tsx` is 1,262 lines** and owns three concerns at once: (a) the form fields, (b) the entire fill state machine (~10 pieces of state: `filling`, `fillOutcome`, `fillRun`, `fillBlocked`, `armed`, `firstFillPrompt`, `fillChanges`, autoFill/fillSignal effects — lines 305-555), (c) the right-rail action cards (lines 1050-1258). Any fill-behavior change requires touching the largest UI file; the component remounts wholesale on item switch.
- **P25 — Radix internals patched with `!important`** (`index.css:90-92`, `[data-radix-scroll-area-viewport] > div { display: block !important }`). Documented and currently load-bearing (sidebar truncation), but pinned to a private DOM detail of `@radix-ui/react-scroll-area` — will break silently on a Radix upgrade.
- **P26 — Sidebar is fixed 320px** (`App.tsx:496 grid-cols-[320px_1fr]`) with no collapse; at the 900px minimum window the editor gets 580px and the DraftEditor rail (`lg:` = 1024px) stacks — the workspace has effectively two layouts, neither tested at the minimum size.

### G. Minor usability

- **P27 — Category Select is a flat ~50-item list** (`DraftEditor.tsx:893-899`, `ConfirmCard.tsx:224-231`) relying on Radix's first-letter typeahead only; no grouping by department (Radix `SelectGroup` exists and is even exported — P19).
- **P28 — `money()` has no locale formatting** (P10) — prices like `$1200` render without separators in board cards, lists, and the price echo.
- **P29 — Home header crowding**: 8 controls in one row (`Home.tsx:243-288`) with mixed affordances (icon-only toggles beside labeled buttons); at 900px it does not wrap (`flex items-center gap-3`, no `flex-wrap`).

---

## 5. What is deliberately NOT a problem (context for later phases)

These look odd in isolation but are documented owner decisions or safety design — proposals must not "fix" them:

- The classic `HomeLists` behind the Board/Lists toggle — kept by owner decision 2026-07-14 (`Home.tsx:75-76`).
- The staged category confirm gate, first-fill prompt, fresh-Sell-form blocked card, persistent "NOT saved on Grailed" banner — safety UX tied to PRD §8; copy is load-bearing.
- The A1/§F tier structure of DraftEditor and ConfirmCard (owner-picked from mocks).
- `font-display` scarcity, brass primary, mono-for-data — the "studio-blend" theme direction (`index.css:5-11`).
- Measurements UI absence (removed by owner decision 2026-07-14, `DraftEditor.tsx:710-713`).
- The description collapse-to-preview behavior and the floating pencil button (owner feedback 2026-07-14).
