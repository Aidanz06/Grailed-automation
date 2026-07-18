import { describe, expect, it } from 'vitest';
import { agoLabel, cn, errorMessage, formatWhen, isCollabBrand, primaryBrand } from '@/lib/utils';

describe('cn', () => {
  it('merges conflicting tailwind classes (last wins)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('drops falsy conditionals', () => {
    expect(cn('a', false && 'b', undefined, 'c')).toBe('a c');
  });
});

describe('formatWhen', () => {
  it('returns an em dash for missing values', () => {
    expect(formatWhen(null)).toBe('—');
    expect(formatWhen(undefined)).toBe('—');
    expect(formatWhen('')).toBe('—');
  });

  it('parses date-only values as local midnight (no TZ off-by-one)', () => {
    const out = formatWhen('2026-06-25');
    expect(out).toContain('25');
    expect(out).toContain('2026');
    expect(out).not.toContain(':'); // date-only stays time-less
  });

  it('includes a time for full ISO timestamps', () => {
    const out = formatWhen('2026-07-03T17:20:04.174Z');
    expect(out).toContain('2026');
    expect(out).toContain(':');
  });

  it('passes unparseable strings through untouched', () => {
    expect(formatWhen('not-a-date')).toBe('not-a-date');
  });
});

describe('agoLabel', () => {
  const now = 1_000_000_000;
  it('reads "just now" under 10s', () => {
    expect(agoLabel(now - 5_000, now)).toBe('just now');
  });
  it('reads seconds under a minute', () => {
    expect(agoLabel(now - 30_000, now)).toBe('30s ago');
    expect(agoLabel(now - 59_000, now)).toBe('59s ago');
  });
  it('reads minutes under an hour', () => {
    expect(agoLabel(now - 120_000, now)).toBe('2m ago');
  });
  it('reads hours beyond that', () => {
    expect(agoLabel(now - 7_200_000, now)).toBe('2h ago');
  });
  it('clamps future timestamps to "just now"', () => {
    expect(agoLabel(now + 60_000, now)).toBe('just now');
  });
});

describe('errorMessage', () => {
  it('returns a plain Error message', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('strips the Electron IPC wrapper down to the real message', () => {
    const err = new Error("Error invoking remote handler on channel 'items:save': Error: disk full");
    expect(errorMessage(err)).toBe('disk full');
  });

  it('strips the wrapper even without an inner "Error:" prefix', () => {
    const err = new Error("Error invoking remote handler on channel 'fill:start': Chrome not connected");
    expect(errorMessage(err)).toBe('Chrome not connected');
  });

  it('stringifies non-Error values', () => {
    expect(errorMessage('oops')).toBe('oops');
    expect(errorMessage(42)).toBe('42');
  });
});

describe('primaryBrand', () => {
  it('takes the first segment of a collab', () => {
    expect(primaryBrand('Supreme x Comme des Garçons')).toBe('Supreme');
    expect(primaryBrand('Nike × Sacai')).toBe('Nike');
    expect(primaryBrand('a X b')).toBe('a'); // case-insensitive separator
  });

  it('leaves non-collab brands whole', () => {
    expect(primaryBrand('Dolce & Gabbana')).toBe('Dolce & Gabbana');
    expect(primaryBrand('Exile')).toBe('Exile'); // "x" inside a word
    expect(primaryBrand('Off-White')).toBe('Off-White'); // hyphens survive
  });

  it('handles null/undefined as empty', () => {
    expect(primaryBrand(null)).toBe('');
    expect(primaryBrand(undefined)).toBe('');
  });
});

describe('isCollabBrand', () => {
  it('detects " x " and " × " separators', () => {
    expect(isCollabBrand('Supreme x Comme des Garçons')).toBe(true);
    expect(isCollabBrand('Nike × Sacai')).toBe(true);
  });

  it('rejects plain and hyphenated brands', () => {
    expect(isCollabBrand('Dolce & Gabbana')).toBe(false);
    expect(isCollabBrand('Exile')).toBe(false);
    expect(isCollabBrand(null)).toBe(false);
  });
});
