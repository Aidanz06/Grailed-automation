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
  brand_confidence: number;
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
  // A1 staged confirmation: BOTH set = the user confirmed the category, which
  // unlocks the category/size/sub-category/designer cascade on Fill listing.
  // Absent = cascade stays manual (never blind-filled from a suggestion).
  grailed_department?: string;
  grailed_category?: string;
  // Produced by the real vision call; not all set in mock:
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
  median: number | null;
  high: number | null;
  sampleSize?: number;
  outliersDropped?: number;
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
  materials: string;
  condition: string;
  fit: string;
  flaws: string;
  care: string;
}

export type DescSectionKey = 'materials' | 'condition' | 'fit' | 'flaws' | 'care' | 'measurements';
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
