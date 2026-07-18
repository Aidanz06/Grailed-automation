import type { Item } from '@/types';

// Everything a save persists — INCLUDING the photo list (order + membership):
// editor deletes/reorders must reach the DB or autofill uploads the stale set
// (real-run find 2026-07-04: a removed duplicate photo was still uploaded).
// Non-numeric ids (mock/preview-only tiles) are filtered out. Shared by the
// DraftEditor's debounced save, the fill orchestration's pre-fill flush, and
// App's save-and-next shortcut (R3) so all three persist the same shape.
export function editsOf(item: Item) {
  return {
    content: item.content,
    range: item.range,
    attributes: item.attributes,
    descParts: item.descParts,
    measurements: item.measurements,
    photos: item.photos.map((p) => Number(p.id)).filter((n) => Number.isFinite(n)),
  };
}
