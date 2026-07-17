/*
 * Shared data shapes for Tailor Studio. These intentionally mirror what the
 * pipeline/ modules return (vision.extractAttributes, priceProvider.getComps,
 * content.generateContent, store.getItem) so wiring the real backend later is a
 * swap, not a rewrite. Fields the mock doesn't populate but the real pipeline
 * produces are marked optional.
 */

export type ItemStatus = 'draft' | 'needs_review' | 'submitted' | 'grouped';

export interface Photo {
  id: string;
  label: string;
  tint: string;
  /** image URL for the real photo (tailor-photo:// custom protocol); absent in mock */
  src?: string;
  /** cluster confidence from §5.1 grouping; null/undefined until grouped */
  clusterConfidence?: number | null;
}

export interface ExtractedAttributes {
  resembles_brand: string;
  /** Collab partner or sub-line ("Comme des Garçons", "NOCTA") — the fill
   * always sends resembles_brand as the designer (Grailed has no collab
   * entries in its designer list); this rides along as a fact for text/tags.
   * Absent on items extracted before 2026-07-14. */
  collaboration?: string;
  brand_confidence: number;
  /** Specific model / silhouette / graphic name ("Dunk Low", "Detroit Jacket")
   * — the price-defining identity behind the narrow comp query. Absent on
   * items extracted before 2026-07-16. */
  model?: string;
  /** Verbatim text seen on tags/labels/graphics ("ISOKNOCK") — how niche
   * brands get found. Absent on items extracted before 2026-07-16. */
  visible_text?: string;
  /** Variant details that move price (colorway name, panel/material, collab
   * mark). Absent on items extracted before 2026-07-16. */
  distinctive_features?: string[];
  category: string;
  subcategory: string;
  era_style: string;
  primary_color: string;
  size: string;
  size_unclear: boolean;
  condition_rating: string;
  condition_markers: string[];
  // User-selected Grailed listing details (Slice 6 autofill; optional, no
  // store migration — they ride in attributes_json):
  grailed_color?: string;
  grailed_style?: string;
  country_of_origin?: string;
  // Grailed's native Smart Pricing (plan §I) — strictly opt-in per item
  // (default OFF/absent). Both must be set for the fill to touch Grailed's
  // Smart Pricing section: the toggle is enabled and the floor typed, then
  // the user reviews and publishes. Never auto-enabled.
  smart_pricing_enabled?: boolean;
  smart_pricing_floor?: number | null;
  // A1 staged confirmation: BOTH set = the user confirmed the category, which
  // unlocks the category/size/sub-category/designer cascade on Fill listing.
  // Absent = cascade stays manual (never blind-filled from a suggestion).
  grailed_department?: string;
  grailed_category?: string;
  // Produced by the real vision call; not all set in mock:
  /** AI's best fit among Grailed's fixed Style options (or "Unclear") — the
   *  editor auto-adopts it into grailed_style when it validates against the
   *  live option list, same pattern as color/category. */
  grailed_style_estimate?: string;
  secondary_colors?: string[];
  materials?: string[];
  search_keywords?: string[];
  comp_query?: string;
  notes?: string;
}

export interface Comp {
  price: number;
  soldDate: string;
  title: string;
  url: string;
  source?: string;
  sold?: boolean;
}

/** How trustworthy the estimate is (pipeline/range.js confidenceFor):
 * duplicate sold listings of the same item → high; only loosely similar
 * sales → low. ci95 is a confidence interval on the MEDIAN estimate. */
export interface RangeConfidence {
  level: 'high' | 'medium' | 'low';
  ci95: [number | null, number | null];
  strongMatches: number;
  moderateMatches: number;
  effectiveN: number;
  spreadCv: number;
  explanation: string;
}

export interface PriceRange {
  currency: string;
  low: number | null;
  /** The price to use — the seller-editable "your price", what autofill fills.
   * Since plan §D2 the pipeline seeds it with the recommended LIST price
   * (~70th weighted pct of sold sales — offer headroom built in). */
  median: number | null;
  high: number | null;
  /** Weighted SOLD median — the expected-sale figure ("typically sells ~$X").
   * Absent on ranges computed before the list/sell split. */
  soldMedian?: number | null;
  /** The recommended list price as computed (median is seeded from it). */
  listAt?: number | null;
  /** Comps whose Grailed condition is is_new — drives the NWT thin-comps note. */
  newCompCount?: number;
  sampleSize?: number;
  outliersDropped?: number;
  /** High-tail sales kept at reduced weight instead of dropped (plan §D2). */
  outliersDownweighted?: number;
  basis?: string;
  mostRelevantComps: Comp[];
  /** UI-mock only: a longer static list behind the "view all" expander */
  allComps?: Comp[];
  /** Absent for ranges computed before confidence existed — Recompute adds it. */
  confidence?: RangeConfidence | null;
}

export interface ListingContent {
  title: string;
  description: string;
  tags: string[];
  disclaimers: string[];
  title_alternatives?: string[];
}

export interface DescParts {
  overview: string;
  /** AI specifics behind the condition rating (Description Styles Phase 1) —
   * reads after "Condition: <rating>, ". Absent on items generated before
   * 2026-07-17; those carried the whole line in the legacy `condition` key. */
  condition_note?: string;
  fit: string;
  flaws: string;
  // Legacy pre-styles keys — still present on old stored items; the template
  // engine falls back to `condition` for the condition_note chip.
  materials?: string;
  condition?: string;
  care?: string;
}

// "measurements" was removed from the section set (owner decision 2026-07-14):
// on Grailed, measurements go through Grailed's own measurements system, never
// the description — the app no longer collects or renders them anywhere. The
// Measurements type + Item.measurements stay so legacy saved data round-trips.
export type DescSectionKey = 'materials' | 'condition' | 'fit' | 'flaws' | 'care';
export type PresetName = 'Minimal' | 'Standard' | 'Detailed' | 'Custom';

export interface DescProfile {
  preset: PresetName;
  sections: Record<DescSectionKey, boolean>;
}

/** Free-form measurement keys — WHICH keys apply comes from the per-category
 * template in lib/measurements.ts (tops ≠ bottoms ≠ footwear). Values are
 * user-entered inches (or tagged size for footwear); blanks are skipped. */
export type Measurements = Record<string, string>;

export interface Flag {
  type: string;
  detail?: string;
  resolved: boolean;
}

export interface Item {
  id: number;
  status: ItemStatus;
  /** Import batch (album) this item arrived in; null for pre-album items. */
  albumId?: number | null;
  photos: Photo[];
  attributes: ExtractedAttributes;
  content: ListingContent | null;
  descParts: DescParts | null;
  measurements: Measurements | null;
  range: PriceRange | null;
  flags: Flag[];
  createdAt?: string;
  submittedAt?: string;

  // ---- UI-only transient state (not part of the persisted/pipeline shape) ----
  /** per-item description-detail override; null/undefined = inherit the global default */
  descProfile?: DescProfile | null;
  dirty?: boolean;
  regenerating?: boolean;
  showAllComps?: boolean;
}
