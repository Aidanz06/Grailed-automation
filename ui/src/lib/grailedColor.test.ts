import { describe, expect, it } from 'vitest';
import { mapGrailedColor } from '@/lib/grailedColor';

// Grailed's live color list (grailed-selectors.json dropdowns.color.options).
const OPTIONS = ['Black', 'White', 'Gray', 'Brown', 'Beige', 'Yellow', 'Red', 'Orange', 'Pink', 'Purple', 'Blue', 'Green', 'Multi', 'Silver', 'Gold'];

describe('mapGrailedColor', () => {
  it('exact matches, case-insensitive', () => {
    expect(mapGrailedColor('black', OPTIONS)).toBe('Black');
    expect(mapGrailedColor('Blue', OPTIONS)).toBe('Blue');
  });

  it('synonyms the old matcher missed (the live bug: grey → Gray)', () => {
    expect(mapGrailedColor('grey', OPTIONS)).toBe('Gray');
    expect(mapGrailedColor('charcoal', OPTIONS)).toBe('Gray');
    expect(mapGrailedColor('cream', OPTIONS)).toBe('Beige');
    expect(mapGrailedColor('navy', OPTIONS)).toBe('Blue');
    expect(mapGrailedColor('off-white', OPTIONS)).toBe('White');
    expect(mapGrailedColor('olive', OPTIONS)).toBe('Green');
  });

  it('compound free text still lands via substring ("dark green" → Green)', () => {
    expect(mapGrailedColor('dark green', OPTIONS)).toBe('Green');
    expect(mapGrailedColor('navy blue', OPTIONS)).toBe('Blue');
    expect(mapGrailedColor('heather grey', OPTIONS)).toBe('Gray');
  });

  it('no invented colors: unknown / blank stay null', () => {
    expect(mapGrailedColor('paisley', OPTIONS)).toBeNull();
    expect(mapGrailedColor('', OPTIONS)).toBeNull();
    expect(mapGrailedColor(null, OPTIONS)).toBeNull();
    expect(mapGrailedColor('black', [])).toBeNull();
  });
});
