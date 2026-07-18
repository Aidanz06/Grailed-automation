import type { ExtractedAttributes, Item, Photo } from '@/types';

/** N mock photos (shape mirrors mock/items.ts — no src needed off-Electron). */
export function makePhotos(n: number): Photo[] {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, label: `photo ${i + 1}`, tint: '#333' }));
}

export function makeAttrs(over: Partial<ExtractedAttributes> = {}): ExtractedAttributes {
  return {
    resembles_brand: 'Carhartt',
    brand_confidence: 0.9,
    category: 'outerwear',
    subcategory: 'denim jacket',
    era_style: '90s workwear',
    primary_color: 'brown',
    size: 'L',
    size_unclear: false,
    condition_rating: 'Used',
    condition_markers: [],
    grailed_department: 'Menswear',
    grailed_category: 'Outerwear',
    ...over,
  };
}

/**
 * A draft that passes every required readiness row (photos, title, description,
 * category, size, condition, price) — tests knock out one field at a time.
 */
export function makeItem(over: Partial<Item> = {}, attrs: Partial<ExtractedAttributes> = {}): Item {
  return {
    id: 1,
    status: 'draft',
    photos: makePhotos(3),
    attributes: makeAttrs(attrs),
    content: {
      title: 'Carhartt Detroit Jacket Brown',
      description: 'Classic Detroit jacket, blanket lined.',
      tags: ['carhartt', 'workwear'],
      disclaimers: [],
    },
    descParts: null,
    measurements: null,
    range: { currency: 'USD', low: 60, median: 80, high: 120, mostRelevantComps: [] },
    flags: [],
    ...over,
  };
}
