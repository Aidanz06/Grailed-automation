import { describe, expect, it } from 'vitest';
import { editsOf } from '@/lib/edits';
import { adaptPhotos } from '@/lib/api';
import type { Item, Photo } from '@/types';

function itemWith(photos: Photo[]): Item {
  return {
    id: 1,
    status: 'draft',
    photos,
    attributes: {} as Item['attributes'],
    content: null,
    descParts: null,
    measurements: null,
    range: null,
    flags: [],
  };
}

describe('editsOf photos (UX audit #1 — added photos must survive the save)', () => {
  it('keeps store-backed photos (numeric ids) in display order', () => {
    // The shape photos:add returns — adapted exactly like adaptItem's photos,
    // so tiles added via the picker persist instead of being filtered out.
    const photos = adaptPhotos([
      { id: 41, file_path: '/shoot/a.jpg', cluster_confidence: null },
      { id: 43, file_path: '/extra/c.jpg', cluster_confidence: null },
      { id: 42, file_path: '/shoot/b.jpg', cluster_confidence: 0.9 },
    ]);
    expect(editsOf(itemWith(photos)).photos).toEqual([41, 43, 42]);
    // And they render from disk via the photo protocol, not as bare tints.
    expect(photos[0].src).toContain('tailor-photo://');
  });

  it('still filters preview-only placeholder tiles (non-numeric ids)', () => {
    const photos: Photo[] = [
      { id: '41', label: 'a.jpg', tint: '#333' },
      { id: 'p1752900000000', label: 'photo 2', tint: '#5a3a6b' },
    ];
    expect(editsOf(itemWith(photos)).photos).toEqual([41]);
  });
});
