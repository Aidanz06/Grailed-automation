import { describe, expect, it } from 'vitest';
import { quality, qualityTitle } from '@/lib/quality';
import { makeItem, makePhotos } from '@/test/fixtures';

/*
 * Score model under test: 7 required rows share 80 points (warn = half
 * credit), boosts add brand-confidence 8 + 5-or-more-photos 6 + price-floor 6.
 */

describe('quality score', () => {
  it('all required done, no boosts earned → exactly 80', () => {
    // 3 photos (< 5) and low brand confidence: complete but boost-less.
    const q = quality(makeItem({}, { brand_confidence: 0.3 }));
    expect(q.score).toBe(80);
    expect(q.boosts).toEqual([]);
  });

  it('brand boost rides on the readiness brand row', () => {
    const q = quality(makeItem());
    expect(q.score).toBe(88);
    expect(q.boosts).toEqual(['brand high-confidence']);
  });

  it('all boosts → capped at 100', () => {
    const q = quality(
      makeItem({ photos: makePhotos(6) }, { smart_pricing_enabled: true, smart_pricing_floor: 40 })
    );
    expect(q.score).toBe(100);
    expect(q.boosts).toEqual(['brand high-confidence', '5+ photos', 'price floor set']);
  });

  it('a warn row earns half credit', () => {
    // size_unclear → 6 done + 1 warn: 6·(80/7) + 40/7 ≈ 74.3 → 74
    const q = quality(makeItem({}, { size_unclear: true, brand_confidence: 0.3 }));
    expect(q.score).toBe(74);
  });

  it('over-limit photos: warn on the row AND no photo boost', () => {
    const q = quality(makeItem({ photos: makePhotos(10) }));
    // photos row warns (half credit) but brand boost still applies: ≈82.3 → 82
    expect(q.score).toBe(82);
    expect(q.boosts).not.toContain('5+ photos');
  });

  it('price-floor boost needs the toggle AND the floor', () => {
    const enabledOnly = quality(makeItem({}, { smart_pricing_enabled: true, smart_pricing_floor: null }));
    expect(enabledOnly.boosts).not.toContain('price floor set');
    const floorOnly = quality(makeItem({}, { smart_pricing_floor: 40 }));
    expect(floorOnly.boosts).not.toContain('price floor set');
  });
});

describe('quality state', () => {
  it('maps status and readiness to the coarse state', () => {
    expect(quality(makeItem({ status: 'submitted' })).state).toBe('listed');
    expect(quality(makeItem({ status: 'needs_review' })).state).toBe('review');
    expect(quality(makeItem({ content: null })).state).toBe('review'); // untitled = still review
    expect(quality(makeItem()).state).toBe('ready');
    expect(quality(makeItem({}, { size: '' })).state).toBe('attention');
  });
});

describe('qualityTitle', () => {
  it('lists earned boosts', () => {
    expect(qualityTitle(quality(makeItem()))).toBe('Listing quality 88/100 · boosts: brand high-confidence');
  });

  it('omits the boost clause when none earned', () => {
    expect(qualityTitle(quality(makeItem({}, { brand_confidence: 0.3 })))).toBe('Listing quality 80/100');
  });
});
