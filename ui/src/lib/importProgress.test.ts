import { describe, expect, it } from 'vitest';
import { importProgress } from '@/lib/importProgress';

const at = (stage: Parameters<typeof importProgress>[0]['stage'], done = 0, total = 0) =>
  importProgress({ stage, done, total });

describe('importProgress mapping', () => {
  it('weights the stages: prep 0–15, grouping 15–55, pipeline 55–100', () => {
    expect(at('grouping')).toEqual({ pct: 2, creep: false });
    expect(at('preparing', 0, 10).pct).toBe(2);
    expect(at('preparing', 10, 10).pct).toBe(15);
    expect(at('describing', 0, 10).pct).toBe(15);
    expect(at('describing', 5, 10).pct).toBe(35);
    expect(at('grouped')).toEqual({ pct: 55, creep: false });
    expect(at('processing', 0, 4).pct).toBe(55);
    expect(at('processing', 2, 4).pct).toBe(77.5);
    expect(at('processing', 4, 4).pct).toBe(100);
    expect(at('done').pct).toBe(100);
    expect(at('error').pct).toBe(100);
  });

  it('marks only the denominator-less vision call as creep', () => {
    expect(at('analyzing')).toEqual({ pct: 50, creep: true });
    for (const stage of ['grouping', 'preparing', 'describing', 'grouped', 'processing', 'done', 'error'] as const) {
      expect(at(stage).creep).toBe(false);
    }
  });

  it('never runs backwards or past 100 on a bad denominator', () => {
    expect(at('processing', 8, 4).pct).toBe(100); // done > total clamps
    expect(at('preparing', 3, 0).pct).toBe(2); // total 0 → frac 0
  });

  it('is monotonic across a typical run', () => {
    const run = [
      at('grouping'),
      at('preparing', 5, 10),
      at('preparing', 10, 10),
      at('analyzing'),
      at('grouped'),
      at('processing', 1, 3),
      at('processing', 3, 3),
      at('done'),
    ].map((p) => p.pct);
    const sorted = [...run].sort((a, b) => a - b);
    expect(run).toEqual(sorted);
  });
});
