/*
 * User-facing item-status vocabulary — ONE rename point (QW-7). "submitted"
 * deliberately reads as "listed" everywhere, aligned with Home's "Currently
 * listed on Grailed".
 *
 * NOT related: FillChangesCard's STATUS_WORD maps fill-run FIELD statuses
 * (filling/ok/failed/skipped), not item statuses — it stays file-local.
 */

import type { ItemStatus } from '@/types';

export const STATUS_LABEL: Record<ItemStatus, string> = {
  draft: 'draft',
  needs_review: 'needs review',
  submitted: 'listed',
  grouped: 'grouped',
};

/** Compact variant for tight rows (command palette) — same vocabulary, short
 * form of needs_review only. */
export const STATUS_WORD: Record<ItemStatus, string> = {
  ...STATUS_LABEL,
  needs_review: 'review',
};
