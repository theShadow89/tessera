import { describe, it, expect } from 'vitest';
import { autoPinCount, pinCenters } from '../src/geometry/connectors.js';

// autoPinCount is pure (no WASM), so it can be unit-tested directly. It sizes
// the number of alignment pins on an interface to the interface's longer edge.
describe('autoPinCount', () => {
  const D = 4; // pin diameter used across cases

  it('returns 1 for a non-positive or tiny edge', () => {
    expect(autoPinCount(0, D)).toBe(1);
    expect(autoPinCount(-10, D)).toBe(1);
    // Below 3 * diameter (12mm) a second pin would not fit with edge margins.
    expect(autoPinCount(11, D)).toBe(1);
  });

  it('uses at least 2 pins once the edge is large enough to rotate', () => {
    // 12mm reaches the 3*D threshold; round(12/45)=0 is clamped up to 2.
    expect(autoPinCount(12, D)).toBe(2);
    expect(autoPinCount(60, D)).toBe(2); // round(60/45)=1 -> clamped to 2
  });

  it('adds pins with length, spaced ~45mm apart', () => {
    expect(autoPinCount(90, D)).toBe(2); // round(2.0)=2
    expect(autoPinCount(120, D)).toBe(3); // round(2.67)=3
    expect(autoPinCount(150, D)).toBe(3); // round(3.33)=3
    expect(autoPinCount(200, D)).toBe(4); // round(4.44)=4
  });

  it('caps at 5 pins for very long edges', () => {
    expect(autoPinCount(1000, D)).toBe(5);
  });

  it('scales the small-edge threshold with pin diameter', () => {
    // With a 10mm pin the single-pin threshold is 30mm.
    expect(autoPinCount(25, 10)).toBe(1);
    expect(autoPinCount(35, 10)).toBe(2);
  });
});

// pinCenters places pins on a Z-normal interface (axis 2). The in-plane axes are
// X (index 0) and Y (index 1). Bounds below make X the longer axis.
describe('pinCenters safety insets', () => {
  const OFFSET = 5; // plane coordinate on the normal axis
  const bbox = { min: [0, 0, OFFSET], max: [100, 40, OFFSET] }; // 100 (X) x 40 (Y)

  it('keeps every pin at least `margin` from both edges', () => {
    const margin = 4;
    const centers = pinCenters(2, OFFSET, bbox, 3, margin, 0);
    expect(centers).toHaveLength(3);
    for (const c of centers) {
      expect(c[0]).toBeGreaterThanOrEqual(bbox.min[0] + margin - 1e-9);
      expect(c[0]).toBeLessThanOrEqual(bbox.max[0] - margin + 1e-9);
      expect(c[1]).toBeCloseTo(20); // centred on the short (Y) axis
      expect(c[2]).toBe(OFFSET);
    }
    // Outermost pins sit exactly on the inset band edges.
    expect(centers[0][0]).toBeCloseTo(margin);
    expect(centers[2][0]).toBeCloseTo(100 - margin);
  });

  it('centres a single pin', () => {
    const centers = pinCenters(2, OFFSET, bbox, 1, 4, 0);
    expect(centers).toHaveLength(1);
    expect(centers[0][0]).toBeCloseTo(50);
    expect(centers[0][1]).toBeCloseTo(20);
  });

  it('caps the count so spacing stays >= minPitch', () => {
    // usable band = 100 - 2*4 = 92; minPitch 30 -> floor(92/30)+1 = 4 max.
    const centers = pinCenters(2, OFFSET, bbox, 10, 4, 30);
    expect(centers).toHaveLength(4);
    // Adjacent spacing must respect the pitch.
    for (let i = 1; i < centers.length; i++) {
      expect(centers[i][0] - centers[i - 1][0]).toBeGreaterThanOrEqual(30 - 1e-9);
    }
  });

  it('places no pins when the face is too small for safe walls', () => {
    // Short (Y) edge is 40; a margin of 25 needs 2*25 = 50 > 40, so no fit.
    expect(pinCenters(2, OFFSET, bbox, 2, 25, 0)).toHaveLength(0);
  });
});
