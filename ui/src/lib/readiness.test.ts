import { describe, expect, it } from 'vitest';
import { GRAILED_PHOTO_LIMIT, buildRows, isTriageDraft, readiness, triageSort } from '@/lib/readiness';
import { makeItem, makePhotos } from '@/test/fixtures';
import type { Item } from '@/types';

const row = (item: Item, key: string) => {
  const r = buildRows(item).find((x) => x.key === key);
  if (!r) throw new Error(`no row ${key}`);
  return r;
};

describe('buildRows — photos', () => {
  it('todo with no photos', () => {
    expect(row(makeItem({ photos: [] }), 'photos').state).toBe('todo');
  });

  it('done up to the Grailed cap', () => {
    expect(row(makeItem({ photos: makePhotos(1) }), 'photos').state).toBe('done');
    expect(row(makeItem({ photos: makePhotos(GRAILED_PHOTO_LIMIT) }), 'photos').state).toBe('done');
  });

  it('warn over the cap, with a remove-count call to action', () => {
    const r10 = row(makeItem({ photos: makePhotos(10) }), 'photos');
    expect(r10.state).toBe('warn');
    expect(r10.short).toBe('remove 1 photo');
    expect(row(makeItem({ photos: makePhotos(12) }), 'photos').short).toBe('remove 3 photos');
  });
});

describe('buildRows — text fields', () => {
  it('title/description are todo when empty or whitespace', () => {
    const item = makeItem();
    item.content = { ...item.content!, title: '   ', description: '' };
    expect(row(item, 'title').state).toBe('todo');
    expect(row(item, 'description').state).toBe('todo');
  });
});

describe('buildRows — brand check (optional verify row)', () => {
  it('done at high confidence with a named brand', () => {
    expect(row(makeItem({}, { brand_confidence: 0.65 }), 'brand').state).toBe('done');
  });

  it('warn at low confidence or an unclear brand', () => {
    expect(row(makeItem({}, { brand_confidence: 0.3 }), 'brand').state).toBe('warn');
    expect(row(makeItem({}, { resembles_brand: 'unclear' }), 'brand').state).toBe('warn');
  });
});

describe('buildRows — category', () => {
  it('done only when BOTH department and category are confirmed', () => {
    expect(row(makeItem(), 'category').state).toBe('done');
    expect(row(makeItem({}, { grailed_category: undefined }), 'category').state).toBe('warn');
    expect(row(makeItem({}, { grailed_department: undefined }), 'category').state).toBe('warn');
  });

  it('surfaces the suggestion when unconfirmed and mappable', () => {
    const r = row(makeItem({}, { grailed_department: undefined, grailed_category: undefined }), 'category');
    expect(r.sub).toContain('suggested Menswear › Outerwear'); // from "denim jacket"
  });

  it('asks for a manual pick when nothing maps', () => {
    const r = row(
      makeItem({}, { grailed_department: undefined, grailed_category: undefined, category: 'widget', subcategory: 'gadget' }),
      'category'
    );
    expect(r.sub).toContain('pick + confirm');
  });
});

describe('buildRows — size and condition', () => {
  it('size: todo missing, warn when tagged unclear, done otherwise', () => {
    expect(row(makeItem({}, { size: '' }), 'size').state).toBe('todo');
    expect(row(makeItem({}, { size: '' }), 'size').short).toBe('add size');
    const unclear = row(makeItem({}, { size_unclear: true }), 'size');
    expect(unclear.state).toBe('warn');
    expect(unclear.short).toBe('verify size');
    expect(row(makeItem(), 'size').state).toBe('done');
  });

  it('condition: done when rated, warn on "Unclear", todo when missing', () => {
    expect(row(makeItem(), 'condition').state).toBe('done');
    expect(row(makeItem({}, { condition_rating: 'Unclear' }), 'condition').state).toBe('warn');
    expect(row(makeItem({}, { condition_rating: '' }), 'condition').state).toBe('todo');
  });
});

describe('buildRows — price', () => {
  it('done whenever a median exists (including 0), todo otherwise', () => {
    expect(row(makeItem(), 'price').state).toBe('done');
    expect(row(makeItem({ range: null }), 'price').state).toBe('todo');
    const zero = makeItem();
    zero.range = { ...zero.range!, median: 0 };
    expect(row(zero, 'price').state).toBe('done');
  });
});

describe('readiness', () => {
  it('a complete draft is ready with no blocker', () => {
    const r = readiness(makeItem());
    expect(r.ready).toBe(true);
    expect(r.blocker).toBeNull();
    expect(r.requiredCount).toBe(7);
    expect(r.doneCount).toBe(7);
  });

  it('warn counts as unresolved and becomes the blocker', () => {
    const r = readiness(makeItem({}, { size_unclear: true }));
    expect(r.ready).toBe(false);
    expect(r.blocker?.key).toBe('size');
    expect(r.doneCount).toBe(6);
  });

  it('the blocker is the FIRST unresolved required row', () => {
    const item = makeItem({ photos: [] }, { size: '' });
    expect(readiness(item).blocker?.key).toBe('photos');
  });

  it('the optional brand row never blocks readiness', () => {
    expect(readiness(makeItem({}, { brand_confidence: 0.1 })).ready).toBe(true);
  });
});

describe('isTriageDraft', () => {
  it('true only for drafts with a generated title', () => {
    expect(isTriageDraft(makeItem())).toBe(true);
    expect(isTriageDraft(makeItem({ status: 'needs_review' }))).toBe(false);
    expect(isTriageDraft(makeItem({ status: 'submitted' }))).toBe(false);
    expect(isTriageDraft(makeItem({ content: null }))).toBe(false);
  });
});

describe('triageSort', () => {
  it('bands: review → unready drafts → ready drafts → listed', () => {
    const listed = makeItem({ id: 1, status: 'submitted' });
    const ready = makeItem({ id: 2 });
    const unready = makeItem({ id: 3 }, { size: '' });
    const review = makeItem({ id: 4, status: 'needs_review' });
    const untitled = makeItem({ id: 5, content: null });
    const sorted = triageSort([listed, ready, unready, review, untitled]);
    expect(sorted.map((it) => it.id)).toEqual([4, 5, 3, 2, 1]);
  });

  it('is stable within a band (store order kept)', () => {
    const a = makeItem({ id: 10 }, { size: '' });
    const b = makeItem({ id: 11 }, { condition_rating: '' });
    const c = makeItem({ id: 12 }, { size: '' });
    expect(triageSort([a, b, c]).map((it) => it.id)).toEqual([10, 11, 12]);
  });
});
