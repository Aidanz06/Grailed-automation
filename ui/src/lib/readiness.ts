/*
 * Single source of truth for draft readiness (UX streamlining R1): buildRows
 * was extracted from ListingChecklist so the editor checklist, the sidebar
 * triage chips, and the Finish-drafts queue can never disagree about what a
 * draft still needs. Pure derivation from the item — this gates nothing; the
 * final review + publish always happens manually in Chrome.
 */

import { useRef } from 'react';
import type { Item } from '@/types';
import { suggestGrailedCategory } from '@/lib/grailedCategory';

export type RowState = 'done' | 'warn' | 'todo';

/** Grailed's per-listing photo cap (support FAQ; multi-file upload past the 9
 * rendered slots proven live 2026-07-19). Twin of grailed-selectors.json
 * `photos.maxPhotos` (the driver's source; the renderer can't read that
 * file): the fill REFUSES to upload more than this, so surface it before the
 * fill. */
export const GRAILED_PHOTO_LIMIT = 25;

export interface ReadinessRow {
  key: string;
  label: string;
  state: RowState;
  sub: string;
  required: boolean;
  tag?: string; // small chip next to the label ('verify' / 'optional')
  jumpTo: string; // DOM id of the section that edits this
  /** Compact call-to-action for chips ("add size", "confirm category"). */
  short: string;
}

export function buildRows(item: Item): ReadinessRow[] {
  const attrs = item.attributes;
  const title = item.content?.title?.trim() ?? '';
  const desc = item.content?.description?.trim() ?? '';
  const confirmed = !!(attrs.grailed_department && attrs.grailed_category);
  const suggestion = suggestGrailedCategory(attrs);
  const highConf = attrs.brand_confidence >= 0.65 && !!attrs.resembles_brand && attrs.resembles_brand !== 'unclear';
  const median = item.range?.median;
  const nPhotos = item.photos.length;

  return [
    {
      key: 'photos',
      label: 'Photos',
      required: true,
      jumpTo: 'sec-photos',
      state: !nPhotos ? 'todo' : nPhotos > GRAILED_PHOTO_LIMIT ? 'warn' : 'done',
      sub: !nPhotos
        ? 'no photos in this group'
        : nPhotos > GRAILED_PHOTO_LIMIT
          ? `${nPhotos} photos — Grailed allows ${GRAILED_PHOTO_LIMIT}, remove ${nPhotos - GRAILED_PHOTO_LIMIT}`
          : `${nPhotos} of ${GRAILED_PHOTO_LIMIT} photos — uploaded by Fill listing`,
      short:
        nPhotos > GRAILED_PHOTO_LIMIT
          ? `remove ${nPhotos - GRAILED_PHOTO_LIMIT} photo${nPhotos - GRAILED_PHOTO_LIMIT === 1 ? '' : 's'}`
          : 'no photos',
    },
    {
      key: 'title',
      label: 'Title',
      required: true,
      jumpTo: 'sec-title',
      state: title ? 'done' : 'todo',
      sub: title ? `${title.length} characters` : 'write a title (or Regenerate)',
      short: 'write title',
    },
    {
      key: 'brand',
      label: 'Brand check',
      required: false,
      tag: 'verify',
      jumpTo: 'sec-title',
      state: highConf ? 'done' : 'warn',
      sub: highConf ? `${attrs.resembles_brand} — high confidence` : 'low confidence — verify from tags',
      short: 'verify brand',
    },
    {
      key: 'description',
      label: 'Description',
      required: true,
      jumpTo: 'sec-desc',
      state: desc ? 'done' : 'todo',
      sub: desc ? `${desc.length} characters` : 'write a description (or Regenerate)',
      short: 'write description',
    },
    {
      key: 'category',
      label: 'Grailed category',
      required: true,
      jumpTo: 'sec-category',
      state: confirmed ? 'done' : 'warn',
      sub: confirmed
        ? `${attrs.grailed_department} › ${attrs.grailed_category}`
        : suggestion
          ? `suggested ${suggestion.department} › ${suggestion.category} — confirm it`
          : 'pick + confirm so Fill can set category/size on Grailed',
      short: 'confirm category',
    },
    {
      key: 'size',
      label: 'Size',
      required: true,
      jumpTo: 'sec-details',
      state: attrs.size ? (attrs.size_unclear ? 'warn' : 'done') : 'todo',
      sub: attrs.size
        ? attrs.size_unclear
          ? `“${attrs.size}” guessed — tag unclear, verify`
          : attrs.size
        : 'add a size (needed so Fill can set it on Grailed)',
      short: attrs.size ? 'verify size' : 'add size',
    },
    {
      key: 'condition',
      label: 'Condition',
      required: true,
      jumpTo: 'sec-details',
      state: attrs.condition_rating && attrs.condition_rating !== 'Unclear' ? 'done' : attrs.condition_rating === 'Unclear' ? 'warn' : 'todo',
      sub:
        attrs.condition_rating && attrs.condition_rating !== 'Unclear'
          ? attrs.condition_rating
          : attrs.condition_rating === 'Unclear'
            ? 'unclear from photos — judge it yourself'
            : 'pick a condition',
      short: 'pick condition',
    },
    {
      key: 'colorstyle',
      label: 'Color & style',
      required: false,
      tag: 'optional',
      jumpTo: 'sec-more', // §F option B: color/style live in the collapsed "More details"
      state: attrs.grailed_color ? 'done' : 'todo',
      sub: attrs.grailed_color
        ? `${attrs.grailed_color}${attrs.grailed_style ? ' · ' + attrs.grailed_style : ''}`
        : 'skipped if blank — Grailed doesn’t require them',
      short: 'add color',
    },
    {
      key: 'price',
      label: 'Price',
      required: true,
      jumpTo: 'sec-price',
      state: median != null ? 'done' : 'todo',
      sub: median != null ? `$${median}` : 'set a price or recompute from comps',
      short: 'set price',
    },
  ];
}

export interface Readiness {
  rows: ReadinessRow[];
  /** Every required row is done (warn counts as unresolved). */
  ready: boolean;
  /** The first required row that isn't done — what to fix next. */
  blocker: ReadinessRow | null;
  doneCount: number;
  requiredCount: number;
}

export function readiness(item: Item): Readiness {
  const rows = buildRows(item);
  const req = rows.filter((r) => r.required);
  const doneCount = req.filter((r) => r.state === 'done').length;
  const blocker = req.find((r) => r.state !== 'done') ?? null;
  return { rows, ready: !blocker, blocker, doneCount, requiredCount: req.length };
}

/** A draft the readiness pass applies to (review items have their own queue). */
export function isTriageDraft(item: Item): boolean {
  return item.status === 'draft' && !!item.content?.title;
}

/*
 * Sidebar triage order (R1): review items stay on top (they block everything
 * else), then drafts that still need a human, then ready drafts, then listed.
 * The sort is STABLE within each band, so relative store order is kept. App's
 * J/K navigation and fill-next queue use the same order — what "next" means is
 * always what the sidebar shows next.
 */
export function triageSort(items: Item[]): Item[] {
  const band = (it: Item): number => {
    if (it.status === 'needs_review' || !it.content?.title) return 0;
    if (it.status === 'submitted') return 3;
    return readiness(it).ready ? 2 : 1;
  };
  return items
    .map((it, i) => ({ it, i, band: band(it) }))
    .sort((a, b) => a.band - b.band || a.i - b.i)
    .map((x) => x.it);
}

/*
 * Display/queue order with FROZEN positions: editing a draft can flip its
 * readiness (e.g. the confident-category auto-adopt on open), and a live
 * triageSort then physically moves rows mid-navigation. This hook re-bands
 * only on deliberate transitions — items added/removed, a status change, or
 * content appearing — so chips update live but rows stay put. Every consumer
 * of the order (sidebar, J/K queue, fill-next) must use it, or "next" drifts
 * from what's on screen.
 */
export function useTriageOrder(items: Item[]): Item[] {
  const orderKey = items.map((it) => `${it.id}:${it.status}:${it.content?.title ? 1 : 0}`).join('|');
  const rankRef = useRef<{ key: string; rank: Map<number, number> } | null>(null);
  if (rankRef.current?.key !== orderKey) {
    rankRef.current = { key: orderKey, rank: new Map(triageSort(items).map((it, i) => [it.id, i])) };
  }
  const rank = rankRef.current.rank;
  // Map fresh item objects onto the frozen ranks each render (never return
  // stale objects — the chips must reflect live edits).
  return [...items].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
}
