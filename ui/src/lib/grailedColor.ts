/*
 * Map the pipeline's free-text primary_color onto Grailed's fixed color list
 * (grailed-selectors.json dropdowns.color.options, delivered via
 * getAutofillOptions). Extracted from the DraftForm adoption effect because
 * its exact/substring match silently missed common synonyms — found live
 * 2026-07-19: "grey" never matched Grailed's "Gray", so items shipped without
 * a color even though the editor's adoption effect ran. Twin logic in
 * ui/main.js mapGrailedColor() (the fill-time fallback for items whose editor
 * was never opened) — keep them in sync.
 */

/** Free-text synonym → the Grailed option it means. Keys and values are
 * matched case-insensitively; keep this list conservative — a wrong color is
 * worse than a blank one (the row is optional on Grailed). */
const COLOR_SYNONYMS: Record<string, string> = {
  grey: 'Gray',
  charcoal: 'Gray',
  navy: 'Blue',
  cream: 'Beige',
  'off-white': 'White',
  'off white': 'White',
  ivory: 'White',
  tan: 'Beige',
  khaki: 'Beige',
  olive: 'Green',
  burgundy: 'Red',
  maroon: 'Red',
  multicolor: 'Multi',
  'multi-color': 'Multi',
  multicolour: 'Multi',
  multicolored: 'Multi',
};

export function mapGrailedColor(primary: string | null | undefined, options: string[]): string | null {
  const pc = (primary ?? '').trim().toLowerCase();
  if (!pc || !options.length) return null;
  const exact = options.find((c) => c.toLowerCase() === pc);
  if (exact) return exact;
  // Synonyms before substring so "charcoal" can't drift into a bad substring hit.
  const syn = Object.entries(COLOR_SYNONYMS).find(([k]) => pc === k || pc.includes(k));
  if (syn) {
    const target = options.find((c) => c.toLowerCase() === syn[1].toLowerCase());
    if (target) return target;
  }
  // Original substring behavior ("dark green" → Green) — both directions.
  return options.find((c) => pc.includes(c.toLowerCase()) || c.toLowerCase().includes(pc)) ?? null;
}
