# Claude Code implementation prompts — tester feedback

Six paste-ready prompts derived from `docs/PLAN-description-and-pricing-improvements.md`.
Run them as **separate Claude Code sessions**, in this order. Prompt 1 (photo bug)
is first — it can put wrong photos on a real listing. Each prompt is
self-contained; paste one, let it finish and verify, then move on.

**Global rules baked into each prompt** (also in `CLAUDE.md`): never submit;
login/captcha manual; no fingerprint/UA spoofing; one manual click per fill;
DOM selectors live in `grailed-selectors.json`; and **check the current committed
code before building** (this repo is more advanced than some docs assume — don't
rebuild what exists).

---

## Prompt 1 — Fix autofill uploading the wrong/previous photos (HIGH priority)

```
Read CLAUDE.md and section F of docs/PLAN-description-and-pricing-improvements.md.

Bug: during autofill, photos from a previous/different listing end up on the
Grailed sell form; the user must restart to get the right photos. Root cause:
uploadPhotos() in ui/autofill-driver.js fills the form's empty photo slots on
whatever sell form is targeted, so a reused/non-empty /sell/new (or the wrong
sell tab when several are open) makes new photos append to old ones.

Implement:
1. One fresh, EMPTY sell form per fill — each fill targets a newly opened
   /sell/new tab and that specific tab, not a reused form.
2. In uploadPhotos(), assert the photo slots are empty first; if any are already
   filled, ABORT with a clear message ("this Sell form already has photos — open
   a fresh one") instead of appending. Never mix photo sets.
3. If multiple sell tabs are open, target the newest/active one (or close stale
   ones). Tighten the "Chrome ready" notion so it means fresh + empty, not just
   URL = /sell/new (see ui/chrome-status.js / chrome-launch.js openSellTab).

Constraints: never submit; keep selectors/URLs in grailed-selectors.json; don't
add any new page-injection/detection surface beyond what the driver already does;
one manual click per fill stays.

Verify: with a real launched Chrome, fill an item, then fill a second WITHOUT
manually reopening the form → the second must refuse the non-empty form (no mixed
photos). With a fresh form per item, each gets exactly its own photos. Test with
two sell tabs open to confirm correct-tab targeting. Then npm run ui:typecheck.
Pause and ask me before changing anything outside the photo/tab-targeting path.
```

---

## Prompt 2 — Low-risk copy & UI wins (Minimal default, no brand in title, objective copy, photo numbers)

```
Read CLAUDE.md and sections B, H, C, and E of
docs/PLAN-description-and-pricing-improvements.md. These are prompt/UI-only.

B (default to Minimal, measurements off): in ui/src/lib/description.ts set
DEFAULT_PROFILE = { preset: 'Minimal', sections: { ...PRESETS.Minimal } }. Leave
the presets themselves intact so the toggles still work.

H (brand out of the title): in pipeline/content.js, update the title schema
description + system rule so the title is item + era/notable feature/model WITHOUT
the designer/brand name (the brand fills the designer field/cascade). Keep it
short (<7 words). Apply to title_alternatives too. Example: "Acne Studios Denim
Jacket" -> "Denim Jacket" / "Boxy Denim Jacket, FW18".

C (simple, objective, factually grounded copy): in pipeline/content.js add hard
rules —
  (a) State ONLY facts present in the input attributes. Never introduce a color,
      colorway, material, collaboration, era, or feature that isn't given; if
      unknown, omit — never guess. (A black item must never be called red/white.)
  (b) Objective tone only — ban hype phrases ("modern streetwear classic",
      "timeless", "must-have", "grail", "elevate your wardrobe", "versatile",
      "clean", etc.).
  (c) No cosmetic/wear adjectives in overview/materials/fit; real flaws go only in
      the flaws section; the condition line is rating-based, not a wear inventory.
  (d) Add a conservative backstop scrub (like the existing authenticity scrub in
      content.js) that strips those hype phrases if the model slips.
Keep the existing authenticity rules and never-invent-measurements intact.

E (photo order numbers): in ui/src/components/PhotoRow.tsx render a live position
badge (i+1) on every tile from the render index (not the stale photo.label);
keep position 1 marked as the thumbnail (e.g. "1 · thumbnail"). Numbers must
update when photos are reordered/deleted.

Verify: npm run ui:typecheck clean; regenerate a few real drafts and confirm
titles omit the brand, colors/details match the photos, no hype phrases remain,
and the photo tiles show 1..N updating on reorder.
```

---

## Prompt 3 — Make the designer/brand dropdown commit reliably

```
Read CLAUDE.md and section G of docs/PLAN-description-and-pricing-improvements.md.

Bug: after the designer/brand autocomplete opens, the value sometimes isn't
selected and the user must click it manually. Root cause: fillAutocomplete() in
ui/autofill-driver.js clicks the suggestion then checks the committed value, but
the suggestion list is still loading or the click doesn't register in time.

Harden fillAutocomplete():
1. Wait for the suggestion list to settle (poll until it stops changing) before
   clicking, within the existing ~4s budget.
2. After clicking, verify the input holds the suggestion's canonical value; if
   not, retry type->poll->click up to ~2x with small backoff.
3. On final failure, CLEAR the typed text so the field isn't left half-entered,
   and report the field clearly so the user knows to pick it manually.

Constraints: selectors/timings in grailed-selectors.json; no new detection
surface; never submit.

Verify against a real Chrome: fill designer repeatedly incl. multi-word brands
(e.g. "Louis Vuitton") → commits without manual clicks; simulate a slow/failed
suggestion → field ends clean + flagged, not half-typed. Then npm run ui:typecheck.
```

---

## Prompt 4 — Pricing: fix NWT/condition detection and the "too low" estimate

```
Read CLAUDE.md and sections D and D2 of
docs/PLAN-description-and-pricing-improvements.md.

Two problems:
(1) Condition mis-detection: a brand-new (tags attached) garment was extracted as
    "Used", which drags both the copy and the price. In pipeline/vision.js tighten
    the condition_rating prompt: infer "New with tags" when tags are visibly
    attached or there's no wear; choose "Used" only on visible wear; when
    ambiguous choose "Unclear" — NEVER default to "Used". Capture the tag/deadstock
    signal in condition_markers.
(2) Recommended price reads too low: range.median is the weighted SOLD median
    (accepted-offer level), but sellers list ABOVE sold prices. In pipeline/range.js
    keep the sold median as the expected-sale figure and derive a LIST price above
    it (target a higher percentile ~65-75th, or q75) with offer headroom; in
    ui/src/components/PricePanel.tsx show both ("List at ~$Y · typically sells
    ~$X"). Tighten comp relevance so cheap loosely-matched comps stop dragging the
    median (prefer brand/subcategory match before allOptional; down-weight rather
    than hard-drop high outliers). For NWT items, weight toward same-condition
    (is_new) comps; if those are thin, lower confidence rather than guess. Surface
    an NWT badge + a "few new comps — may be conservative" note.

Constraints: do NOT touch the guarded comp provider, cache, or circuit breaker.
Keep the confidence math coherent (thin same-condition comps -> lower confidence,
not false precision).

Verify: compare the same item NWT vs used and against what an experienced seller
would list at; confirm the "list at / sells" split, the NWT badge, and graceful
confidence on thin comps. Run npm run clustering:gate if the pipeline changes
touch shared code. npm run ui:typecheck for the UI.
```

---

## Prompt 5 — Description style templates (the tester's headline request)

```
Read CLAUDE.md and section A of docs/PLAN-description-and-pricing-improvements.md.

Add a user "description style template": an example listing the seller pastes so
generations match their voice/format. Generation runs at import AND on Regenerate,
so the template must be a PERSISTENT setting both paths read — not renderer-only.

Implement:
1. Storage: a persisted setting (one global template string for V1) in the SQLite
   store, with settings:get/settings:set IPC in ui/main.js + preload, exposed as
   api.getStyleTemplate()/setStyleTemplate() in ui/src/lib/api.ts (+ mock).
2. Prompt wiring: generateContent(attributes, { styleExample }) in
   pipeline/content.js — when present, append BELOW the hard rules: "Match the
   seller's preferred style. Example of how they write listings: «template».
   Emulate its tone, structure, and length, but use THIS item's facts, and never
   copy its specific details, measurements, or price." Hard rules (no authenticity,
   no invented measurements/colors, objective tone) always win over the template.
3. Pass the setting through both the batch path (main.js/processItem) and the
   Regenerate IPC. If unset, behavior is identical to today (optional param).
4. UI: a pencil button in the Description section header of
   ui/src/components/DraftEditor.tsx opens a small editor to paste/edit the
   template ("Used as a style example for all generations. Facts still come from
   each item."), saves the setting, and offers "Regenerate with my style".

Verify: with a template set, regenerated descriptions follow its format/tone;
with none set, output is byte-identical to before; the template survives restart
and applies to a new import. Confirm it never overrides facts or safety rules.
npm run ui:typecheck.
```

---

## Prompt 6 — Autofill support for Grailed Smart Pricing (opt-in)

```
Read CLAUDE.md and section I of docs/PLAN-description-and-pricing-improvements.md.

Add autofill support for Grailed's native Smart Pricing (seller enables it + sets
a floor; Grailed auto-lowers toward the floor). This fills Grailed's own setting
for the user to review — it is NOT autonomous price-dropping. Off by default;
opt-in per item; the user still reviews and Publishes.

Implement:
1. Capture selectors live: use the phase0b probe to capture the Smart Pricing
   toggle + floor-price input on /sell/new into a new `smartPricing` block in
   grailed-selectors.json. Never hardcode selectors.
2. Driver: add a smartPricing fill step in ui/autofill-driver.js (enable toggle +
   type floor) that runs ONLY when the item opted in; stream it in the fill
   checklist like other fields; never submit.
3. UI: an opt-in Smart Pricing control + floor input in ui/src/components/
   DraftEditor.tsx / PricePanel.tsx. Suggest the sold-median as the floor (pairs
   with D2's "list at $Y, floor at $X"). Default OFF.
4. Wire through buildFillPayload in ui/main.js and the item model/types.

Constraints: opt-in only, never auto-enable, never autonomous; selectors in
grailed-selectors.json; never submit.

Verify against a real Chrome: opt in, fill, and confirm the Smart Pricing toggle +
floor land on the form; default is off; nothing enables without the user. Then
npm run ui:typecheck.
```

---

### Notes

- **Prompts 1, 3, 6** touch `ui/autofill-driver.js` — the guarded fill layer.
  They need a **real launched Chrome to verify**, not just typecheck; a mock pass
  isn't enough for these.
- **Prompt 4** touches pricing internals — validate against real comps/items.
- **Prompts 2 and 5** are the safest; 2 is the fastest tester-visible win after
  the photo fix.
