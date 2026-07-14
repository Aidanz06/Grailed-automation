/*
 * Listing quality score (refinement plan §D4): the readiness rows → a 0–100
 * score plus a coarse state, so "is this good enough to post?" is a number
 * the batch board and sidebar can sort, filter, and gate "Ready" on. Derived
 * entirely from lib/readiness.ts — the single source of what a draft still
 * needs — so the score can never disagree with the checklist. This gates
 * nothing in the app itself: fills stay manually triggered per item and the
 * final review + publish always happens in Chrome.
 */

import type { Item } from '@/types';
import { readiness, type Readiness } from '@/lib/readiness';

export type QualityState = 'review' | 'attention' | 'ready' | 'listed';

export interface Quality {
  /** 0–100. Required fields carry 80 points (a `warn` row earns half credit);
   * signal boosts carry the remaining 20. */
  score: number;
  state: QualityState;
  /** Signal boosts earned, human-readable — for tooltips. */
  boosts: string[];
  /** The underlying readiness derivation (rows / blocker / counts). */
  r: Readiness;
}

const REQUIRED_POINTS = 80;

/** Signal boosts (§D4): not required to post, but each one measurably helps
 * the listing — brand the buyer can trust, enough photos, a floor for
 * Grailed's Smart Pricing. Weights sum to 20. */
const BOOSTS: Array<{ points: number; label: string; earned: (item: Item, r: Readiness) => boolean }> = [
  {
    points: 8,
    label: 'brand high-confidence',
    earned: (_item, r) => r.rows.find((row) => row.key === 'brand')?.state === 'done',
  },
  {
    points: 6,
    label: '5+ photos',
    earned: (item) => item.photos.length >= 5,
  },
  {
    points: 6,
    label: 'price floor set',
    earned: (item) => !!item.attributes.smart_pricing_enabled && item.attributes.smart_pricing_floor != null,
  },
];

export function quality(item: Item): Quality {
  const r = readiness(item);
  const req = r.rows.filter((row) => row.required);
  const per = REQUIRED_POINTS / Math.max(1, req.length);
  let score = 0;
  for (const row of req) score += row.state === 'done' ? per : row.state === 'warn' ? per / 2 : 0;

  const boosts: string[] = [];
  for (const b of BOOSTS) {
    if (b.earned(item, r)) {
      score += b.points;
      boosts.push(b.label);
    }
  }

  const state: QualityState =
    item.status === 'submitted'
      ? 'listed'
      : item.status === 'needs_review' || !item.content?.title
        ? 'review'
        : r.ready
          ? 'ready'
          : 'attention';

  return { score: Math.min(100, Math.round(score)), state, boosts, r };
}

/** One-line tooltip body for a score ("82/100 · boosts: 5+ photos"). */
export function qualityTitle(q: Quality): string {
  return `Listing quality ${q.score}/100${q.boosts.length ? ` · boosts: ${q.boosts.join(', ')}` : ''}`;
}
