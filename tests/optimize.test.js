import { describe, it, expect } from 'vitest';
import { minCuts, optimalCutOffsets } from '../src/core/optimize.js';

describe('minCuts', () => {
  it('is 0 when the span fits', () => {
    expect(minCuts(100, 150)).toBe(0);
    expect(minCuts(150, 150)).toBe(0);
  });
  it('is ceil(span/usable)-1 otherwise', () => {
    expect(minCuts(300, 150)).toBe(1); // 2 slabs
    expect(minCuts(300, 100)).toBe(2); // 3 slabs
    expect(minCuts(310, 100)).toBe(3); // 4 slabs
  });
});

describe('optimalCutOffsets', () => {
  it('returns no cuts when the span fits', () => {
    expect(optimalCutOffsets(0, 100, 150, [])).toEqual([]);
  });

  it('picks the low-area candidate within the feasible window, not the midpoint', () => {
    // span 100, usable 55 -> 1 cut, feasible window c in [45,55].
    // Narrow neck (small area) at 46; bulk (large area) at 50.
    const candidates = [
      { pos: 20, area: 9000 }, // outside feasible window (100-20=80 > 55)
      { pos: 46, area: 400 }, // neck, feasible
      { pos: 50, area: 9000 }, // midpoint, feasible but large area
      { pos: 54, area: 9000 },
    ];
    const offs = optimalCutOffsets(0, 100, 55, candidates);
    expect(offs).toEqual([46]);
  });

  it('respects the slab constraint (rejects an out-of-window low-area neck)', () => {
    // Neck at 20 is smallest but 0..20 ok, 20..100=80 > 55 -> infeasible.
    const candidates = [
      { pos: 20, area: 100 }, // infeasible as the only cut
      { pos: 48, area: 5000 },
    ];
    const offs = optimalCutOffsets(0, 100, 55, candidates);
    expect(offs).toEqual([48]);
  });

  it('places two cuts minimising total area', () => {
    // span 300, usable 120 -> 3 slabs, 2 cuts. Necks near 110 and 210.
    const candidates = [];
    for (let p = 20; p < 300; p += 10) {
      const area = p === 110 || p === 210 ? 200 : 5000;
      candidates.push({ pos: p, area });
    }
    const offs = optimalCutOffsets(0, 300, 120, candidates);
    expect(offs).toEqual([110, 210]);
    // Both slabs valid: 0-110, 110-210, 210-300 all <= 120.
  });

  it('falls back to equal spacing when candidates are too sparse', () => {
    const offs = optimalCutOffsets(0, 300, 150, []); // needs 1 cut, no candidates
    expect(offs).toEqual([150]);
  });
});
