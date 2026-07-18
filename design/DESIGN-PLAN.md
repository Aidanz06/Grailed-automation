# Tailor Studio — UI refinement plan

Planning artifact only — no code has been changed. Mockups referenced live in this
folder. Decided with Aidan over 6 mockup rounds, July 2026.

**FINAL SCOPE (owner decision, end of exploration):** no redesign — a set of
**small presentation-only improvements** to the existing studio-blend theme.
The primary surface is the **workspace** (sidebar queue | editor | rail), not
the Home board. Definitive mock: `design/workspace-improvements.html`
("Improvements off" = today, "On" = the full proposed change set, font
switcher for the pending sans decision). Everything below this line is
reference material from the exploration; where it conflicts with the final
scope, the final scope wins.

**Home-board mock:** `design/triage-board-final.html` (extras off = pure restyle).
**Faithful current-app replica for diffing:** `design/round4…` / `round5…` / `round6…` first tab.

---

## 1. Decision log (what was explored, what won)

| Round | Explored | Outcome |
|---|---|---|
| 1 | Editorial / Japandi / Swiss full restyles | Liked editorial + swiss; material rejected as poor fit |
| 2 | Hybrid theme + theme-picker demo, outlined buttons | Buttons too raw; "keep the refined feel the app already has" |
| 3 | Refined hybrid with motion polish | Better, but still not "the real app" |
| 4 | Exact current-app replica vs hybrid reskin | Looked better, but verdict: **refine what exists, don't restyle** |
| 5 | Current vs refined-current (tokens tuned only) | Direction confirmed; wants icon buttons, less "book-like" font |
| 6 + north star | All-sans, icon-first, full craft pass | **Final direction** |

**Kept (identity):** dark studio default, champagne-brass accent, Space Grotesk,
JetBrains Mono for data, existing motion system (shimmer, draw-check, rise-in),
existing layout and information architecture.

**Dropped:** Instrument Serif everywhere (wordmark + PricePanel display price move
to Space Grotesk 600) — reads "book-like" to the owner. Full restyles (editorial /
japandi / swiss) — shelved; hybrid tokens from round 2–4 are archived in these
mockups if ever wanted as an alternate theme.

---

## 2. Principles

0. **Presentation-only — zero behavior change.** (Owner constraint, July 2026.)
   The restyle must not add, remove, or alter any feature, flow, shortcut,
   data display rule, or IPC behavior. Anything that shows new information or
   adds an interaction (summary strip, quick actions, filter counts, visible
   keyboard hints, review reframe) is an **optional addition** — see §6 — each
   its own separate decision and PR, off by default. `triage-board-final.html`
   demonstrates the split: "Extras off" is the pure restyle.
1. **Refine, don't replace.** Every change is a knob-turn on the existing
   studio-blend theme (`ui/src/index.css`), not a new system.
2. **Legibility floor: 11.5px.** Nothing interactive or informative below it.
   The 9–10px sizes in cards/badges all move up.
3. **One typographic voice.** Space Grotesk for UI and display; JetBrains Mono
   only where numbers are compared (prices, counts, scores). No serif.
4. **Icon-first controls.** Icon buttons with tooltips wherever the action is
   habitual; text labels only on the primary CTA per screen and destructive
   confirmations. Watch discoverability on "Confirm drafts" (count badge required).
5. **Buttons look pressable.** Border + shadow at rest, −1px translate on hover,
   scale(.94–.97) on press, brass focus-visible ring. Applies to filter chips too.
6. **Motion is the house style.** Reuse existing keyframes; standard easing
   `cubic-bezier(.2,.7,.3,1)`, 130ms (controls) / 180ms (cards) / 450ms (entrances).
   All gated by `prefers-reduced-motion` (already the codebase convention).

---

## 3. Token changes — `ui/src/index.css`

Only `.dark` values shift meaningfully; light twin gets the same contrast bump.
Brass, teal success, amber warning are unchanged (identity colors).

```css
.dark {
  /* current                        → refined */
  --background: 220 20% 6.5%;       /* → 220 18% 7.5%  (slightly lifted) */
  --card:       219 18% 9.5%;       /* → 219 18% 11%   (more separation from bg) */
  --secondary:  219 16% 13%;        /* → 219 16% 14.5% (raised surface) */
  --muted-foreground: 219 12% 62%;  /* → 219 13% 72%   (THE legibility fix) */
  --border: 218 30% 88% / 0.09;     /* → / 0.14 */
  --input:  218 30% 88% / 0.16;     /* → / 0.22 */
  --success: 165 60% 55%;           /* → 165 60% 58% */
  --warning: 41 86% 60%;            /* → 41 86% 62% */
}
:root { /* light twin */
  --muted-foreground: 35 8% 44%;    /* → 35 8% 38% */
  --border: 35 20% 20% / 0.14;      /* → / 0.16 */
  --input:  35 20% 20% / 0.2;       /* → / 0.24 */
}
```

New tokens to add (used by shadows/tooltips): `--shadow: 0 1px 2px rgb(0 0 0/.3)`,
`--shadow-up: 0 10px 28px rgb(0 0 0/.45)` (light: `rgb(60 45 20/.06)` / `.13`),
and a `--faint` tier (`219 12% 52%`) for tertiary data like the quality score.

Contrast check (approx.): muted text on background goes from ~5.5:1 to ~8:1;
at the new 11.5–12px sizes both pass WCAG AA comfortably.

**Font changes:**
- Decided: remove `@fontsource/instrument-serif` usage; `font-display` in
  `tailwind.config.cjs` remaps to the UI sans at weight 600 (wordmark,
  PricePanel display price). Keep the family alias so markup doesn't churn.
- **Pending owner pick** ("more refined fonts"): the UI sans itself. Candidates
  side-by-side in `triage-board-final.html` font switcher — Space Grotesk
  (current, quirky), **Geist** (even, technical-refined), **Hanken Grotesk**
  (humanist-refined), **Manrope** (rounder). All available via @fontsource for
  self-hosting like the current fonts. JetBrains Mono stays for data either way
  (pairs cleanly with all four; Geist Mono is the alternative if Geist wins).

## 4. Type scale (component sizes, current → refined)

| Element | Current | Refined | File |
|---|---|---|---|
| Card title | `text-[13px]` | 14px | `TriageBoard.tsx` |
| Card state line | `text-[10px] uppercase` | 12px, sentence case, dot+tint pill | `TriageBoard.tsx` (`StateLine`) |
| Card price line | `text-[11px]` mono | 12px mono; price itself 14px/500 brass | `TriageBoard.tsx` |
| Photo-count chip | `text-[9px]` | 10.5px, larger padding | `TriageBoard.tsx` |
| Quality score | `text-[11px]` muted | keep 11px but `--faint`; tooltip unchanged | `TriageBoard.tsx` |
| Filter chips | `text-[11px]` borderless | 12.5px pill buttons with counts | `TriageBoard.tsx` |
| Sidebar rows / badges | 10–11px | 11.5–12.5px same pattern | `Sidebar.tsx` |
| Delete "Sure?" | `text-[9px]/[10px]` | 11px | `TriageBoard.tsx`, `Home.tsx` |
| Section headers | keep 12px uppercase (works) | unchanged | various |

Card grid: `minmax(160px,1fr)` → `minmax(184px,1fr)`; padding `p-2.5` → `p-3`;
gap `gap-3` → `gap-4`. Fewer, larger cards = calmer board (owner preference).

## 5. Component changes

**Header (`Home.tsx` ~L243–288)**
- Wordmark: Space Grotesk 600, "Studio" in brass (drop italic serif).
- Ghost icon buttons become bordered icon buttons (34px, shadow, hover lift).
- Board/Lists toggle → icon-only segmented (grid / rows icons, tooltips).
- "Confirm drafts (2)" → clipboard-check icon button with warning-colored count
  badge. *Risk:* discoverability; revisit if usage drops.
- "New batch" keeps `+ New batch` label (sole labeled CTA).

**TriageBoard (`TriageBoard.tsx`)**
- Add summary strip above board bar: Need review / Ready / Listed this week /
  Est. value of ready items (sum of `range.median` over ready). 22px tabular
  numerals; warning-bordered first stat when review > 0.
- Filter pills show counts ("Ready 9"); selected = brass fill + `--primary-foreground`.
- StateLine → tinted pill with 6px leading dot (`--success-dim`/`--warning-dim`
  backgrounds); sentence case.
- Card hover: translateY(-3px) + `--shadow-up` + photo `scale(1.045)` (500ms);
  quick-action icon buttons (Open ↗ / Fill ▶) fade in top-right — reuses the
  `CardDelete` overlay pattern, sits left of it.
- Keyboard: J/K already exist app-wide — add the visible hint row
  (`J K move · ↵ open · F fill`) and a brass selection ring on the focused card.
- Skeleton cards during import reuse `.shimmer` on `--secondary` blocks.

**Sidebar / DraftEditor / PricePanel / ReviewScreen / ConfirmScreen**
- Same type-scale and pill/button treatments applied mechanically.
- PricePanel display price: serif → Space Grotesk 600, same size; RangeBar keeps
  its real-geometry design (it's good) with the higher-contrast borders.
- ReviewScreen: adopt the "one question per group" framing from
  `round3-refined-hybrid.html` (title: "Is this one item or two?", suspect
  photos pre-selected, 1–9/S/↵ keys) — copy change + preselection logic, no layout change.

**Tooltips**
- Native `title` → styled tooltip (CSS `::after` pattern or Radix Tooltip, already
  a dependency family): 11.5px, `--secondary` surface, 350ms delay. Required for
  icon-first to work.

## 6. Optional additions — NOT part of the restyle (each a separate yes/no)

Per §2.0 these are feature changes and ship only if individually approved,
after the restyle phases are done. Previewable via "Extras on" in
`triage-board-final.html`:

1. Summary strip with **est. $ value ready** (new derived metric on the board).
2. **Quick actions on cards** — Open/Fill without opening the editor.
3. **Filter chip counts** ("Ready 9").
4. **Visible keyboard hints** — J/K/F exists today but is undiscoverable.
5. **Review-as-a-question** copy reframe in ReviewScreen.

Pure-restyle note: low-confidence attribute highlighting already exists via
flags; restyling its tint/size is presentation, not an addition.

## 7. Accessibility checklist

- [ ] All text ≥11.5px interactive / ≥11px decorative-numeric.
- [ ] Muted-on-bg ≥7:1 in dark, ≥4.5:1 everywhere.
- [ ] `:focus-visible` brass ring on every control (currently partial).
- [ ] State pills readable without color (dot + text, not color alone).
- [ ] Reduced-motion covers new hover/entrance transforms (extend existing block).

## 8. Deferred (explicitly not now)

- **Theme picker** (2–3 curated themes × light/dark). Architecture is trivial on
  the token system — `data-theme` attr + alternate `@layer base` blocks; the
  hybrid/editorial token sets in `round2`/`round4` mockups are ready seeds. Ship
  the refinement first; revisit if still wanted.
- Editorial serif accents — owner rejected ("book-like").
- Any layout/IA changes beyond the summary strip.

## 9. Implementation phases (each = one branch/PR, per Operating Guide)

1. **Tokens + fonts** — `index.css`, `tailwind.config.cjs`, drop instrument-serif
   import in `main.tsx`. Visual diff by hand in both modes. *(smallest, unblocks all)*
2. **Buttons + icon header** — shared button styles, header of `Home.tsx`,
   tooltips. Test: keyboard focus ring on every control.
3. **TriageBoard pass** — type scale, pills, summary strip, quick actions,
   selection ring, skeletons. Test: est.-value sum correct vs store data.
4. **Editor + rail pass** — DraftEditor/PricePanel/Sidebar scale + pill patterns.
5. **ReviewScreen reframe** — copy + preselect + key handling. Failing test first
   for preselection logic.
6. **Sweep + a11y audit** — ConfirmScreen, modals, toasts; run the checklist in §7.

Definition of done per phase (house rules): behavior verified by hand in both
modes + `npm run ui:typecheck` + `npm test` green.
