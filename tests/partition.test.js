import { describe, it, expect } from 'vitest';
import { planGrid, partCount } from '../src/core/partition.js';

// Build a bounding box from a min corner and a size, matching the three.js
// Box3-like shape planGrid expects.
function bbox(min, size) {
  return {
    min: { x: min.x, y: min.y, z: min.z },
    max: { x: min.x + size.x, y: min.y + size.y, z: min.z + size.z },
  };
}

const printer = { x: 250, y: 210, z: 220 };

describe('planGrid', () => {
  it('leaves a model that fits on every axis undivided', () => {
    const plan = planGrid(bbox({ x: 0, y: 0, z: 0 }, { x: 100, y: 100, z: 100 }), printer);
    expect(plan.divisions).toEqual({ x: 1, y: 1, z: 1 });
    expect(plan.planes).toEqual([]);
    expect(plan.fits).toBe(true);
    expect(partCount(plan.divisions)).toBe(1);
  });

  it('splits a 300mm cube into a 2x2x2 grid with centred planes', () => {
    // usable = printer - margin = 248/208/218; 300 / each rounds up to 2.
    const model = bbox({ x: 0, y: 0, z: 0 }, { x: 300, y: 300, z: 300 });
    const plan = planGrid(model, printer, 2);

    expect(plan.divisions).toEqual({ x: 2, y: 2, z: 2 });
    expect(plan.planes).toHaveLength(3);
    expect(plan.fits).toBe(false);
    expect(partCount(plan.divisions)).toBe(8);

    // One plane per axis, each a unit axis vector splitting the model at its centre.
    const byAxis = {
      x: plan.planes.find((p) => p.normal[0] === 1),
      y: plan.planes.find((p) => p.normal[1] === 1),
      z: plan.planes.find((p) => p.normal[2] === 1),
    };
    expect(byAxis.x.normal).toEqual([1, 0, 0]);
    expect(byAxis.y.normal).toEqual([0, 1, 0]);
    expect(byAxis.z.normal).toEqual([0, 0, 1]);

    // Offsets sit exactly at the mid-point (min + size/2) and strictly inside bounds.
    expect(byAxis.x.offset).toBe(model.min.x + 300 / 2);
    expect(byAxis.y.offset).toBe(model.min.y + 300 / 2);
    expect(byAxis.z.offset).toBe(model.min.z + 300 / 2);
    for (const key of ['x', 'y', 'z']) {
      expect(byAxis[key].offset).toBeGreaterThan(model.min[key]);
      expect(byAxis[key].offset).toBeLessThan(model.max[key]);
    }
  });

  it('keeps 1 division when the model exactly equals the usable size (ceil(1) === 1)', () => {
    // usable.x = 250 - 2 = 248; a model exactly 248 wide must stay whole.
    const plan = planGrid(bbox({ x: 0, y: 0, z: 0 }, { x: 248, y: 100, z: 100 }), printer, 2);
    expect(plan.divisions.x).toBe(1);
    expect(plan.planes).toEqual([]);
    expect(plan.fits).toBe(true);
  });

  it('divides only the long axis for an asymmetric model', () => {
    // 600 / 248 -> 3; 100 fits on the other two axes.
    const model = bbox({ x: 0, y: 0, z: 0 }, { x: 600, y: 100, z: 100 });
    const plan = planGrid(model, printer, 2);

    expect(plan.divisions).toEqual({ x: 3, y: 1, z: 1 });
    expect(plan.planes).toHaveLength(2);
    for (const p of plan.planes) expect(p.normal).toEqual([1, 0, 0]);

    const offsets = plan.planes.map((p) => p.offset);
    expect(offsets).toEqual([200, 400]); // evenly spaced: 600 * 1/3, 600 * 2/3
  });

  it('computes offsets from a negative min corner', () => {
    // Same 600mm span but centred on the origin: min.x = -300.
    const model = bbox({ x: -300, y: -50, z: -50 }, { x: 600, y: 100, z: 100 });
    const plan = planGrid(model, printer, 2);

    expect(plan.divisions).toEqual({ x: 3, y: 1, z: 1 });
    const offsets = plan.planes.map((p) => p.offset);
    expect(offsets).toEqual([-100, 100]); // -300 + 600/3, -300 + 2*600/3
  });

  it('lets the margin change the division count', () => {
    // Model exactly the printer width on x, so the margin decides the split.
    const model = bbox({ x: 0, y: 0, z: 0 }, { x: 250, y: 100, z: 100 });

    // margin 0 -> usable 250, 250/250 = 1 -> undivided.
    const loose = planGrid(model, printer, 0);
    expect(loose.divisions.x).toBe(1);

    // margin 50 -> usable 200, 250/200 = 1.25 -> 2 divisions.
    const tight = planGrid(model, printer, 50);
    expect(tight.divisions.x).toBe(2);
  });
});

describe('partCount', () => {
  it('multiplies the per-axis divisions', () => {
    expect(partCount({ x: 3, y: 2, z: 4 })).toBe(24);
    expect(partCount({ x: 1, y: 1, z: 1 })).toBe(1);
  });
});
