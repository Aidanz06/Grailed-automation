/*
 * Renderer data layer (Slice 1: read-only).
 *
 * Talks to the Electron main process over the `window.tailor` bridge (see
 * ui/preload.js + ui/main.js) when running in the packaged app; falls back to
 * MOCK_ITEMS in the browser preview (`npm run ui:dev`) so layout work keeps
 * rendering without a backend.
 *
 * `adaptItem` maps the pipeline/store.js `getItem()` shape onto the UI `Item`
 * type. Store schema gaps (descParts / measurements / descProfile — see
 * WIRING-HANDOFF §"Store schema GAPS") map to null/defaults for now; real items
 * therefore show their raw stored description rather than the assembled one.
 */

import type { Comp, DescParts, ExtractedAttributes, Item, ItemStatus, ListingContent, Measurements, PriceRange } from '@/types';
import { MOCK_ITEMS } from '@/mock/items';
import { DEFAULT_PROFILE, assembleDescription } from '@/lib/description';

// ---- Raw shapes as returned by pipeline/store.js over IPC ----
interface StorePhoto {
  id: number;
  file_path: string;
  cluster_confidence: number | null;
}
interface StoreComp {
  source?: string | null;
  sold_price?: number | null;
  sold_date?: string | null;
  // price_range.mostRelevantComps use the pipeline's camelCase shape instead:
  price?: number | null;
  soldDate?: string | null;
  title?: string | null;
  url?: string | null;
}
interface StoreFlag {
  id: number;
  type: string;
  detail: string | null;
  resolved: number;
}
interface StoreListing {
  title: string | null;
  description: string | null;
  tags: string[];
  price_range: (Partial<PriceRange> & { mostRelevantComps?: StoreComp[]; allComps?: StoreComp[] }) | null;
  content:
    | (Partial<ListingContent> & { desc_parts?: DescParts | null; measurements?: Measurements | null })
    | null;
  submitted_at: string | null;
}
interface StoreItem {
  id: number;
  status: string;
  created_at: string;
  album_id?: number | null;
  attributes: Partial<ExtractedAttributes> | null;
  photos: StorePhoto[];
  listing: StoreListing | null;
  comps: StoreComp[];
  flags: StoreFlag[];
}
/** Raw album row from pipeline/store.js listAlbums(). */
interface StoreAlbum {
  id: number;
  created_at: string;
  folder: string | null;
  name: string;
  hidden: number;
  item_count: number;
  listed_count: number;
  review_count: number;
}
/** One import batch (Lightroom-style album). Hidden albums drop off Home. */
export interface Album {
  id: number;
  name: string;
  folder: string | null;
  createdAt: string;
  hidden: boolean;
  itemCount: number;
  listedCount: number;
  reviewCount: number;
}
interface StoreSummary {
  id: number;
}

/** Edits persisted by Slice 2. Any omitted field is left unchanged in the store. */
export interface ItemEdits {
  content?: ListingContent | null;
  range?: PriceRange | null;
  attributes?: ExtractedAttributes | null;
  descParts?: DescParts | null;
  measurements?: Measurements | null;
  /** Photo ids in display order (0 = Grailed thumbnail). Photos of the item
   * missing from the list are DELETED from the app DB (files untouched) —
   * this is how editor deletes/reorders reach autofill. Omit = unchanged. */
  photos?: number[] | null;
}

/** generateContent result — listing content plus the structured description parts. */
export interface GeneratedContent extends ListingContent {
  descParts: DescParts | null;
}

// Empty record — WHICH blanks to offer comes from lib/measurements.ts
// templates (category-specific), not from fixed keys here.
const BLANK_MEASUREMENTS: Measurements = {};

/** Normalize the model's snake_case desc_parts into the UI DescParts shape. */
function adaptDescParts(dp: DescParts | null | undefined): DescParts | null {
  if (!dp) return null;
  return {
    overview: dp.overview ?? '',
    materials: dp.materials ?? '',
    condition: dp.condition ?? '',
    fit: dp.fit ?? '',
    flaws: dp.flaws ?? '',
    care: dp.care ?? '',
  };
}

/** Raw pipeline range (computeRange output) — same shape as PriceRange minus UI-only bits. */
type PipelineRange = Partial<PriceRange> & { mostRelevantComps?: StoreComp[] };
interface RecomputeRaw {
  comps: StoreComp[];
  range: PipelineRange | null;
  providerName: string;
  cached: boolean;
}
/** Result of a Slice 4 recompute: a UI-ready range plus provenance for the toast. */
export interface RecomputeResult {
  range: PriceRange;
  providerName: string;
  cached: boolean;
}

/** Summary of a Slice 5 batch import. */
export interface BatchResult {
  photoCount: number;
  groups: number;
  drafts: number;
  review: number;
  processed: Array<{
    groupId: number;
    itemId: number | null;
    status: string;
    title?: string | null;
    signature?: string;
    flags?: string[];
    /** Set when this group's pricing/writing failed and it was parked in Review. */
    error?: string;
  }>;
  /** Set when grouping fell back to the secondary strategy (non-fatal). */
  groupingNotice?: string;
  /** Set when some groups errored during pricing/writing (parked in Review, non-fatal). */
  processingNotice?: string;
}

/** One batch:progress event — drives the ImportScreen staged progress bar.
 * preparing/describing carry real per-photo counts from inside the grouping
 * strategy; analyzing is the single opaque batched-vision call (no counts). */
export interface BatchProgress {
  stage: 'grouping' | 'preparing' | 'analyzing' | 'describing' | 'grouped' | 'processing' | 'done' | 'error';
  done: number;
  total: number;
  label: string;
  /** Set when a group was just SAVED as an item — drafts stream in one by one,
   * so the UI can offer "start editing" before the whole batch finishes. */
  item?: { groupId: number; itemId: number | null; status: string; title?: string | null; error?: string };
}

/** One autofill:progress event (S3 live fill checklist). Transport-agnostic —
 * the driver emits the same shape the future extension shell will. `plan`
 * arrives once up front with every field the run will attempt (in order);
 * `field` events bracket each fill. done/total are set for photos only. */
export type FillProgress =
  | { kind: 'plan'; fields: string[] }
  | {
      kind: 'field';
      field: string;
      status: 'filling' | 'ok' | 'failed' | 'skipped';
      done?: number;
      total?: number;
      reason?: string;
    };

/** Per-field outcome of a Slice 6 autofill run (shape from ui/autofill-driver.js). */
export interface FillResult {
  ok: boolean;
  results: Record<string, { ok: boolean; skipped?: boolean; reason?: string; uploadPosts?: number }>;
  targetUrl?: string;
  /** Set by the mock impl only — surfaced in the toast. */
  message?: string;
}

/** Result of dock:start. `message` is set by the mock impl only. */
export interface DockStart {
  ok: boolean;
  alreadyActive?: boolean;
  targetUrl?: string;
  message?: string;
}

/** Pushed with dock:stopped when docking ends on the main side (Chrome quit). */
export interface DockStopped {
  reason: string;
}

/** Results of the review-resolution actions (§5.1 / UX review S1). */
export interface ReviewConfirmResult {
  itemId: number;
  title: string | null;
}
export interface ReviewSplitResult {
  newItemId: number;
  sourceDeleted: boolean;
}
export interface ReviewAssignResult {
  targetItemId: number;
  sourceDeleted: boolean;
}

interface TailorBridge {
  listItems(): Promise<StoreSummary[]>;
  getItem(id: number): Promise<StoreItem | null>;
  saveItem(id: number, edits: ItemEdits): Promise<boolean>;
  markSubmitted(id: number): Promise<boolean>;
  deleteItem(id: number): Promise<boolean>;
  listAlbums(): Promise<StoreAlbum[]>;
  setAlbumHidden(id: number, hidden: boolean): Promise<boolean>;
  reviewConfirm(id: number): Promise<ReviewConfirmResult>;
  reviewSplit(id: number, photoIds: number[]): Promise<ReviewSplitResult>;
  reviewAssign(id: number, photoIds: number[], targetId: number): Promise<ReviewAssignResult>;
  generateContent(
    attributes: ExtractedAttributes,
    instructions?: string
  ): Promise<ListingContent & { desc_parts?: DescParts | null }>;
  recomputeComps(attributes: ExtractedAttributes): Promise<RecomputeRaw>;
  openExternal(url: string): Promise<{ ok: boolean }>;
  pickBatchFolder(): Promise<string | null>;
  processBatch(folder: string): Promise<BatchResult>;
  onBatchProgress(cb: (p: BatchProgress) => void): () => void;
  fillListing(id: number): Promise<FillResult>;
  onFillProgress(cb: (p: FillProgress) => void): () => void;
  getAutofillOptions(): Promise<AutofillOptions>;
  getGuardStatus(): Promise<GuardStatus>;
  getChromeStatus(): Promise<ChromeStatus>;
  launchChrome(): Promise<ChromeLaunchResult>;
  startDock(): Promise<DockStart>;
  stopDock(): Promise<boolean>;
  onDockStopped(cb: (info: DockStopped) => void): () => void;
}

/** §8.1 circuit-breaker state (pipeline/compGuard.js). */
export interface GuardStatus {
  circuitOpen: boolean;
}

/** Read-only snapshot of the launched Chrome (ui/chrome-status.js — one HTTP
 * GET of :9222/json/list, no page connection). Drives the header status chip
 * and the fresh-Sell-form fill gate. `loggedIn` is false only when a Grailed
 * tab sits on a login/signup route (public URL signal); null = unknown. */
export interface ChromeStatus {
  connected: boolean;
  loggedIn: boolean | null;
  sellFormTabs: number;
  activeUrl: string | null;
  ready: boolean;
}

/** Result of the in-app Chrome launcher (ui/chrome-launch.js — spawns the
 * dedicated-profile Chrome on :9222, detached; friendly no-op when a connected
 * Chrome is already up). `message` is user-facing copy for the toast; sign-in
 * always stays manual in that window (PRD §8.2). */
export interface ChromeLaunchResult {
  ok: boolean;
  alreadyRunning: boolean;
  message: string;
}

/** Grailed's fixed color/style option lists + the department→category tree
 * (from grailed-selectors.json). The tree feeds the staged-confirmation
 * category picker (A1). */
export interface AutofillOptions {
  colors: string[];
  styles: string[];
  categoryTree: Record<string, string[]>;
}

export interface Api {
  listItems(): Promise<Item[]>;
  getItem(id: number): Promise<Item | null>;
  saveItem(id: number, edits: ItemEdits): Promise<void>;
  markSubmitted(id: number): Promise<void>;
  /** Permanently delete an item from the app's DB (never touches Grailed). */
  deleteItem(id: number): Promise<void>;
  /** Albums: one per import batch; hide finished batches from the Home lists. */
  listAlbums(): Promise<Album[]>;
  setAlbumHidden(id: number, hidden: boolean): Promise<void>;
  generateContent(attributes: ExtractedAttributes, instructions?: string): Promise<GeneratedContent>;
  recomputeComps(attributes: ExtractedAttributes): Promise<RecomputeResult>;
  /** Open a comp's Grailed listing in the system browser (main-process allowlist). */
  openExternal(url: string): Promise<void>;
  /** §5.1 review resolution: process this group into a draft in place. Slow (~1 min, full pipeline). */
  reviewConfirm(id: number): Promise<ReviewConfirmResult>;
  /** §5.1 review resolution: move the selected photos into a fresh review item. */
  reviewSplit(id: number, photoIds: number[]): Promise<ReviewSplitResult>;
  /** §5.1 review resolution: move the selected photos onto an existing item. */
  reviewAssign(id: number, photoIds: number[], targetId: number): Promise<ReviewAssignResult>;
  /** Opens the native folder picker; resolves to the chosen path or null if canceled. */
  pickBatchFolder(): Promise<string | null>;
  processBatch(folder: string): Promise<BatchResult>;
  /** Live stage/counts during processBatch; returns an unsubscribe fn. */
  onBatchProgress(cb: (p: BatchProgress) => void): () => void;
  /** Slice 6: autofill the sell form in the driven Chrome. Never submits. */
  fillListing(id: number): Promise<FillResult>;
  /** S3: live per-field events during fillListing; returns an unsubscribe fn. */
  onFillProgress(cb: (p: FillProgress) => void): () => void;
  getAutofillOptions(): Promise<AutofillOptions>;
  /** §8.1 breaker state — drives the app-wide warning banner. */
  getGuardStatus(): Promise<GuardStatus>;
  /** Read-only Chrome tab probe — header chip + fresh-Sell-form fill gate. */
  getChromeStatus(): Promise<ChromeStatus>;
  /** Launch the dedicated CDP Chrome (no-op if already up). Login stays manual. */
  launchChrome(): Promise<ChromeLaunchResult>;
  /** §5.5 window docking: snap/unsnap the real Chrome window against the app. */
  startDock(): Promise<DockStart>;
  stopDock(): Promise<void>;
  /** Fires when docking ends main-side (Chrome quit); returns an unsubscribe fn. */
  onDockStopped(cb: (info: DockStopped) => void): () => void;
}

// ---- store -> UI adapters ----

const EMPTY_ATTRIBUTES: ExtractedAttributes = {
  resembles_brand: '',
  brand_confidence: 0,
  category: '',
  subcategory: '',
  era_style: '',
  primary_color: '',
  size: '',
  size_unclear: false,
  condition_rating: '',
  condition_markers: [],
};

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

function adaptComp(c: StoreComp): Comp {
  return {
    price: c.price ?? c.sold_price ?? 0,
    soldDate: c.soldDate ?? c.sold_date ?? '',
    title: c.title ?? '',
    url: c.url ?? '',
    source: c.source ?? undefined,
    sold: true,
  };
}

function adaptRange(listing: StoreListing | null, comps: StoreComp[]): PriceRange | null {
  const pr = listing?.price_range;
  if (!pr) return null;
  // Prefer the comps the pipeline already ranked; otherwise fall back to the
  // raw comps rows so the range still shows what it was based on.
  let relevant = pr.mostRelevantComps?.length ? pr.mostRelevantComps : comps;
  // Backfill listing URLs for items whose stored range predates range.js
  // keeping `url` (real-run find 2026-07-04: every comp row rendered
  // unlinked). The raw comps rows always carried the URL — join on price +
  // sold date (range soldDate is the date prefix of the row's ISO string).
  relevant = relevant.map((c) => {
    if (c.url) return c;
    const price = c.price ?? c.sold_price;
    const day = (c.soldDate ?? c.sold_date ?? '').slice(0, 10);
    const row = comps.find((r) => {
      const rPrice = r.price ?? r.sold_price;
      const rDay = String(r.soldDate ?? r.sold_date ?? '').slice(0, 10);
      return r.url && rPrice === price && (!day || rDay === day);
    });
    return row ? { ...c, url: row.url } : c;
  });
  return {
    currency: pr.currency ?? 'USD',
    low: pr.low ?? null,
    median: pr.median ?? null,
    high: pr.high ?? null,
    sampleSize: pr.sampleSize,
    outliersDropped: pr.outliersDropped,
    basis: pr.basis,
    mostRelevantComps: relevant.map(adaptComp),
    allComps: pr.allComps?.map(adaptComp),
    confidence: pr.confidence ?? null,
  };
}

/** Pipeline computeRange output + full comps list -> UI PriceRange (Slice 4). */
function toUiRange(range: PipelineRange, comps: StoreComp[]): PriceRange {
  return {
    currency: range.currency ?? 'USD',
    low: range.low ?? null,
    median: range.median ?? null,
    high: range.high ?? null,
    sampleSize: range.sampleSize,
    outliersDropped: range.outliersDropped,
    basis: range.basis,
    mostRelevantComps: (range.mostRelevantComps ?? []).map(adaptComp),
    allComps: comps.length ? comps.map(adaptComp) : undefined,
    confidence: range.confidence ?? null,
  };
}

function adaptContent(listing: StoreListing | null): ListingContent | null {
  if (!listing) return null;
  const c = listing.content;
  if (c && (c.title || c.description || c.tags)) {
    return {
      title: c.title ?? listing.title ?? '',
      description: c.description ?? listing.description ?? '',
      tags: c.tags ?? listing.tags ?? [],
      disclaimers: c.disclaimers ?? [],
      title_alternatives: c.title_alternatives,
    };
  }
  if (listing.title == null && listing.description == null && !listing.tags?.length) return null;
  return {
    title: listing.title ?? '',
    description: listing.description ?? '',
    tags: listing.tags ?? [],
    disclaimers: [],
  };
}

function adaptAlbum(a: StoreAlbum): Album {
  return {
    id: a.id,
    name: a.name,
    folder: a.folder,
    createdAt: a.created_at,
    hidden: !!a.hidden,
    itemCount: a.item_count,
    listedCount: a.listed_count,
    reviewCount: a.review_count,
  };
}

export function adaptItem(raw: StoreItem): Item {
  return {
    id: raw.id,
    status: (raw.status as ItemStatus) ?? 'draft',
    albumId: raw.album_id ?? null,
    photos: (raw.photos ?? []).map((p) => ({
      id: String(p.id),
      label: basename(p.file_path),
      tint: '#333', // fallback tint behind/if the image fails to load
      src: `tailor-photo://local/${encodeURIComponent(p.file_path)}`,
      clusterConfidence: p.cluster_confidence ?? null,
    })),
    attributes: { ...EMPTY_ATTRIBUTES, ...(raw.attributes ?? {}) },
    content: adaptContent(raw.listing),
    // desc_parts + measurements ride inside content_json (no dedicated columns).
    // descParts stays null for items generated before this existed → the detail
    // selector hides until the item is regenerated. Measurements default to
    // blank so the (toggleable) measurements grid is editable.
    descParts: adaptDescParts(raw.listing?.content?.desc_parts),
    measurements: raw.listing?.content?.measurements ?? { ...BLANK_MEASUREMENTS },
    range: adaptRange(raw.listing, raw.comps ?? []),
    flags: (raw.flags ?? []).map((f) => ({
      type: f.type,
      detail: f.detail ?? undefined,
      resolved: !!f.resolved,
    })),
    createdAt: raw.created_at,
    submittedAt: raw.listing?.submitted_at ?? undefined,
  };
}

// ---- mock fallback (browser preview / no backend) ----

// Preview-only: ids "deleted" this session so the mock list reflects deletes.
const mockDeletedIds = new Set<number>();

// Preview-only Chrome state for getChromeStatus — flip to 'disconnected' or
// 'no-sell-form' to preview the not-connected chip + Launch Chrome button or
// the not-ready warning/armed-fill UI (there's no real Chrome in ui:dev).
// `let` because the mock launcher advances 'disconnected' → 'no-sell-form',
// mirroring the real launch → sign in → open-a-Sell-form flow.
type MockChromeState = 'ready' | 'no-sell-form' | 'disconnected';
let mockChromeState: MockChromeState = 'ready';

// Preview-only albums: two fake import batches so the Home hide/show flow is
// previewable. Hidden state lives here for the session.
const mockAlbums: Album[] = [
  { id: 1, name: 'rack-shoot — 2026-07-04', folder: '/mock/rack-shoot', createdAt: '2026-07-04', hidden: false, itemCount: 0, listedCount: 0, reviewCount: 0 },
  { id: 2, name: 'closet-clearout — 2026-06-20', folder: '/mock/closet-clearout', createdAt: '2026-06-20', hidden: false, itemCount: 0, listedCount: 0, reviewCount: 0 },
];

function assembledMocks(): Item[] {
  const items = structuredClone(MOCK_ITEMS).filter((it) => !mockDeletedIds.has(it.id));
  for (const it of items) {
    if (it.descParts && it.content) it.content.description = assembleDescription(it, DEFAULT_PROFILE);
    // Spread the mocks across the two fake albums (odd/even), like real
    // imports would land in one album per batch.
    it.albumId = it.id % 2 === 1 ? 1 : 2;
  }
  return items;
}

const mockApi: Api = {
  async listItems() {
    return assembledMocks();
  },
  async getItem(id) {
    return assembledMocks().find((it) => it.id === id) ?? null;
  },
  // No backend in the browser preview — edits live only in React state.
  async saveItem(id) {
    console.log(`[mock] saveItem #${id} — not persisted (no backend)`);
  },
  async markSubmitted(id) {
    console.log(`[mock] markSubmitted #${id} — not persisted (no backend)`);
  },
  async deleteItem(id) {
    console.log(`[mock] deleteItem #${id} — removed for this session only`);
    mockDeletedIds.add(id);
  },
  async listAlbums() {
    const items = assembledMocks();
    return mockAlbums.map((a) => ({
      ...a,
      itemCount: items.filter((it) => it.albumId === a.id).length,
      listedCount: items.filter((it) => it.albumId === a.id && it.status === 'submitted').length,
      reviewCount: items.filter((it) => it.albumId === a.id && it.status === 'needs_review').length,
    }));
  },
  async setAlbumHidden(id, hidden) {
    const a = mockAlbums.find((x) => x.id === id);
    if (a) a.hidden = hidden;
  },
  // Review resolution needs the pipeline + store — simulate outcomes in preview.
  async reviewConfirm(id) {
    console.log(`[mock] reviewConfirm #${id} — no pipeline`);
    await new Promise((r) => setTimeout(r, 900));
    return { itemId: id, title: 'Mock confirmed item' };
  },
  async reviewSplit(id, photoIds) {
    console.log(`[mock] reviewSplit #${id}`, photoIds);
    return { newItemId: 999, sourceDeleted: false };
  },
  async reviewAssign(id, photoIds, targetId) {
    console.log(`[mock] reviewAssign #${id} → #${targetId}`, photoIds);
    return { targetItemId: targetId, sourceDeleted: true };
  },
  async generateContent(attributes) {
    // No Anthropic call in the browser preview — synthesize a plausible draft.
    console.log('[mock] generateContent — no API call');
    await new Promise((r) => setTimeout(r, 700));
    const brand = attributes.resembles_brand || 'Item';
    const sub = attributes.subcategory || attributes.category || '';
    const base = `${brand} ${sub}`.trim();
    const cond = attributes.condition_rating || 'see photos';
    return {
      title: (base + (attributes.size ? ` - ${attributes.size}` : '')).trim(),
      description: `${base}.\nCondition: ${cond}.`,
      tags: [brand, sub, attributes.primary_color].filter(Boolean).map((t) => String(t).toLowerCase()),
      disclaimers: ['Mock regeneration — no API call.'],
      title_alternatives: [],
      descParts: {
        overview: `${base}.`,
        materials: attributes.primary_color ? `${attributes.primary_color} colorway.` : '',
        condition: `Condition: ${cond}.`,
        fit: attributes.size ? `Tagged ${attributes.size}.` : '',
        flaws: '',
        care: 'Ships promptly, well packed.',
      },
    };
  },
  async recomputeComps(attributes) {
    // No live Grailed scrape in the browser preview — synthesize a range.
    console.log('[mock] recomputeComps — no live scrape');
    await new Promise((r) => setTimeout(r, 700));
    const seed = (attributes.resembles_brand || 'x').length + (attributes.subcategory || '').length;
    const median = 40 + (seed % 60);
    const mk = (price: number, soldDate: string, title: string): Comp => ({ price, soldDate, title, url: '', source: 'mock', sold: true });
    const comps = [
      mk(median + 15, '2026-06-10', 'Mock comp A'),
      mk(median, '2026-05-22', 'Mock comp B'),
      mk(median - 12, '2026-04-30', 'Mock comp C'),
    ];
    return {
      range: {
        currency: 'USD',
        low: median - 15,
        median,
        high: median + 25,
        sampleSize: comps.length,
        basis: 'mock recompute',
        mostRelevantComps: comps,
        allComps: comps,
        confidence: {
          level: 'high',
          ci95: [median - 8, median + 8],
          strongMatches: 3,
          moderateMatches: 0,
          effectiveN: 2.8,
          spreadCv: 0.18,
          explanation: '3 near-identical sold listings; tight price spread',
        },
      },
      providerName: 'mock',
      cached: false,
    };
  },
  // Browser preview: a plain new tab stands in for shell.openExternal.
  async openExternal(url) {
    console.log('[mock] openExternal', url);
    if (url) window.open(url, '_blank', 'noopener');
  },
  // No native dialog / file access in the browser preview.
  async pickBatchFolder() {
    console.log('[mock] pickBatchFolder — no native dialog');
    return '/mock/photo-batch';
  },
  // No CDP / driven Chrome in the browser preview — simulate a successful fill
  // (like the other mock endpoints synthesize results) so the post-fill UI
  // (per-field toast, persistent not-saved banner) is previewable.
  async fillListing(id) {
    console.log(`[mock] fillListing #${id} — simulated; real autofill needs the desktop app + launched Chrome`);
    // Simulate the S3 per-field stream so the live fill checklist is previewable.
    const emit = (p: FillProgress) => mockFillSubs.forEach((cb) => cb(p));
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const fields = ['title', 'description', 'price', 'condition', 'photos'];
    emit({ kind: 'plan', fields });
    for (const field of fields.slice(0, 4)) {
      emit({ kind: 'field', field, status: 'filling' });
      await wait(450);
      emit({ kind: 'field', field, status: 'ok' });
    }
    emit({ kind: 'field', field: 'photos', status: 'filling', done: 0, total: 2 });
    for (let i = 1; i <= 2; i++) {
      await wait(500);
      emit({ kind: 'field', field: 'photos', status: 'filling', done: i, total: 2 });
    }
    emit({ kind: 'field', field: 'photos', status: 'ok' });
    return {
      ok: true,
      results: { title: { ok: true }, description: { ok: true }, price: { ok: true }, condition: { ok: true }, photos: { ok: true, uploadPosts: 2 } },
      targetUrl: 'https://www.grailed.com/sell/new',
    };
  },
  onFillProgress(cb) {
    mockFillSubs.add(cb);
    return () => mockFillSubs.delete(cb);
  },
  // No pipeline/disk in the browser preview — breaker always reads closed.
  async getGuardStatus() {
    return { circuitOpen: false };
  },
  // No CDP in the browser preview — reports per mockChromeState ('ready' by
  // default so the normal flow renders; flip it above to walk the other UI).
  async getChromeStatus() {
    if (mockChromeState === 'disconnected')
      return { connected: false, loggedIn: null, sellFormTabs: 0, activeUrl: null, ready: false };
    return mockChromeState === 'ready'
      ? { connected: true, loggedIn: true, sellFormTabs: 1, activeUrl: 'https://www.grailed.com/sell/new', ready: true }
      : { connected: true, loggedIn: null, sellFormTabs: 0, activeUrl: 'https://www.grailed.com/', ready: false };
  },
  // No process spawning in the browser preview — simulate a successful launch
  // (state advances so the polled chip transitions like the real flow).
  async launchChrome() {
    console.log('[mock] launchChrome — real spawn needs the desktop app');
    await new Promise((r) => setTimeout(r, 600));
    const alreadyRunning = mockChromeState !== 'disconnected';
    if (!alreadyRunning) mockChromeState = 'no-sell-form';
    return {
      ok: true,
      alreadyRunning,
      message: alreadyRunning
        ? 'Chrome is already running and connected to the app. Sign in to Grailed there yourself if asked, then open grailed.com/sell/new. (Mock — no real Chrome in the preview.)'
        : 'Chrome is up. Sign in to Grailed there yourself if asked (login is always manual), then open grailed.com/sell/new. (Mock — no real Chrome in the preview.)',
    };
  },
  // No CDP / native windows in the browser preview.
  async startDock() {
    console.log('[mock] startDock — docking needs the desktop app + launched Chrome');
    return { ok: false, message: 'Dock Chrome needs the desktop app with the launched Chrome (mock mode).' };
  },
  async stopDock() {},
  onDockStopped() {
    return () => {};
  },
  // Mirrors grailed-selectors.json (real source of truth in the main process).
  async getAutofillOptions() {
    return {
      colors: ['Black', 'White', 'Gray', 'Brown', 'Beige', 'Yellow', 'Red', 'Orange', 'Pink', 'Purple', 'Blue', 'Green', 'Multi', 'Silver', 'Gold'],
      styles: ['None', 'Luxury', 'Vintage', 'Avant-Garde', 'Streetwear', 'Workwear', 'Gorpcore', 'Sportswear', 'Basics', 'Western'],
      categoryTree: {
        Menswear: ['Tops', 'Bottoms', 'Outerwear', 'Footwear', 'Tailoring', 'Accessories'],
        Womenswear: ['Tops', 'Bottoms', 'Outerwear', 'Dresses', 'Footwear', 'Accessories', 'Bags & Luggage', 'Jewelry'],
      },
    };
  },
  async processBatch(folder) {
    console.log(`[mock] processBatch(${folder}) — no clustering/pipeline`);
    // Simulate the real staged progress so the ImportScreen bar is previewable.
    const emit = (p: BatchProgress) => mockProgressSubs.forEach((cb) => cb(p));
    emit({ stage: 'grouping', done: 0, total: 0, label: 'Scanning folder…' });
    await new Promise((r) => setTimeout(r, 300));
    for (let i = 1; i <= 5; i++) {
      emit({ stage: 'preparing', done: i, total: 5, label: `Preparing photo ${i}/5…` });
      await new Promise((r) => setTimeout(r, 200));
    }
    emit({ stage: 'analyzing', done: 0, total: 0, label: 'AI grouping — all photos in one pass (~20–30s)…' });
    await new Promise((r) => setTimeout(r, 1800));
    emit({ stage: 'grouped', done: 0, total: 2, label: '2 group(s) from 5 photo(s)' });
    await new Promise((r) => setTimeout(r, 400));
    emit({ stage: 'processing', done: 0, total: 2, label: 'Pricing + writing group 1/2…' });
    await new Promise((r) => setTimeout(r, 700));
    // Streamed item events: each saved group announces itself so the UI can
    // offer editing before the batch finishes (mock itemIds are fake).
    emit({
      stage: 'processing', done: 1, total: 2, label: 'Draft ready: Mock grouped item (1/2)',
      item: { groupId: 1, itemId: 1, status: 'draft', title: 'Mock grouped item' },
    });
    await new Promise((r) => setTimeout(r, 700));
    emit({
      stage: 'processing', done: 2, total: 2, label: 'Group 2/2 saved for review',
      item: { groupId: 2, itemId: 2, status: 'needs_review' },
    });
    await new Promise((r) => setTimeout(r, 400));
    emit({ stage: 'done', done: 2, total: 2, label: 'Import complete' });
    return {
      photoCount: 5,
      groups: 2,
      drafts: 1,
      review: 1,
      processed: [
        { groupId: 1, itemId: null, status: 'draft', title: 'Mock grouped item' },
        { groupId: 2, itemId: null, status: 'needs_review', signature: 'mixed pile', flags: ['low_confidence_group'] },
      ],
    };
  },
  onBatchProgress(cb) {
    mockProgressSubs.add(cb);
    return () => mockProgressSubs.delete(cb);
  },
};

// Subscribers for the mock progress streams (browser preview only).
const mockProgressSubs = new Set<(p: BatchProgress) => void>();
const mockFillSubs = new Set<(p: FillProgress) => void>();

function realApi(bridge: TailorBridge): Api {
  return {
    async listItems() {
      const summaries = await bridge.listItems();
      const raws = await Promise.all(summaries.map((s) => bridge.getItem(s.id)));
      return raws.filter((r): r is StoreItem => r != null).map(adaptItem);
    },
    async getItem(id) {
      const raw = await bridge.getItem(id);
      return raw ? adaptItem(raw) : null;
    },
    async saveItem(id, edits) {
      await bridge.saveItem(id, edits);
    },
    async markSubmitted(id) {
      await bridge.markSubmitted(id);
    },
    async deleteItem(id) {
      await bridge.deleteItem(id);
    },
    async listAlbums() {
      return (await bridge.listAlbums()).map(adaptAlbum);
    },
    async setAlbumHidden(id, hidden) {
      await bridge.setAlbumHidden(id, hidden);
    },
    async reviewConfirm(id) {
      return bridge.reviewConfirm(id);
    },
    async reviewSplit(id, photoIds) {
      return bridge.reviewSplit(id, photoIds);
    },
    async reviewAssign(id, photoIds, targetId) {
      return bridge.reviewAssign(id, photoIds, targetId);
    },
    async generateContent(attributes, instructions) {
      const { desc_parts, ...content } = await bridge.generateContent(attributes, instructions);
      return { ...content, descParts: adaptDescParts(desc_parts) };
    },
    async recomputeComps(attributes) {
      const { comps, range, providerName, cached } = await bridge.recomputeComps(attributes);
      return { range: toUiRange(range ?? {}, comps ?? []), providerName, cached };
    },
    async openExternal(url) {
      await bridge.openExternal(url);
    },
    async pickBatchFolder() {
      return bridge.pickBatchFolder();
    },
    async processBatch(folder) {
      return bridge.processBatch(folder);
    },
    onBatchProgress(cb) {
      return bridge.onBatchProgress(cb);
    },
    async fillListing(id) {
      return bridge.fillListing(id);
    },
    onFillProgress(cb) {
      return bridge.onFillProgress(cb);
    },
    async getAutofillOptions() {
      return bridge.getAutofillOptions();
    },
    async getGuardStatus() {
      return bridge.getGuardStatus();
    },
    async getChromeStatus() {
      return bridge.getChromeStatus();
    },
    async launchChrome() {
      return bridge.launchChrome();
    },
    async startDock() {
      return bridge.startDock();
    },
    async stopDock() {
      await bridge.stopDock();
    },
    onDockStopped(cb) {
      return bridge.onDockStopped(cb);
    },
  };
}

const bridge = (globalThis as unknown as { tailor?: TailorBridge }).tailor;
export const api: Api = bridge ? realApi(bridge) : mockApi;
