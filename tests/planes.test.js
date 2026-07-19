import { describe, it, expect } from 'vitest';
import {
  axisOfNormal,
  manualToPlanes,
  planesToManual,
  estimatePartCount,
  fitReport,
} from '../src/core/planes.js';

describe('axisOfNormal', () => {
  it('maps unit normals to axis letters', () => {
    expect(axisOfNormal([1, 0, 0])).toBe('x');
    expect(axisOfNormal([0, 1, 0])).toBe('y');
    expect(axisOfNormal([0, 0, 1])).toBe('z');
  });
});

describe('manualToPlanes / planesToManual', () => {
  it('round-trips manual planes through cutter form', () => {
    const manual = [
      { axis: 'x', offset: 10 },
      { axis: 'z', offset: -5.5 },
    ];
    const planes = manualToPlanes(manual);
    expect(planes).toEqual([
      { normal: [1, 0, 0], offset: 10 },
      { normal: [0, 0, 1], offset: -5.5 },
    ]);
    expect(planesToManual(planes)).toEqual(manual);
  });
});

describe('estimatePartCount', () => {
  it('is 1 with no planes', () => {
    expect(estimatePartCount([])).toBe(1);
  });

  it('multiplies (planes+1) per axis', () => {
    // 1 x-plane, 1 y-plane, 1 z-plane -> 2*2*2 = 8 (a 2x2x2 grid)
    const planes = manualToPlanes([
      { axis: 'x', offset: 150 },
      { axis: 'y', offset: 150 },
      { axis: 'z', offset: 150 },
    ]);
    expect(estimatePartCount(planes)).toBe(8);
  });

  it('counts multiple planes on the same axis', () => {
    // 2 x-planes -> 3 slabs along x, nothing else -> 3 parts
    const planes = manualToPlanes([
      { axis: 'x', offset: 100 },
      { axis: 'x', offset: 200 },
    ]);
    expect(estimatePartCount(planes)).toBe(3);
  });

  it('ignores planes on or outside the bounds', () => {
    const bounds = { min: { x: 0, y: 0, z: 0 }, max: { x: 300, y: 300, z: 300 } };
    const planes = manualToPlanes([
      { axis: 'x', offset: 0 }, // on the edge, cuts nothing
      { axis: 'x', offset: 400 }, // outside, cuts nothing
      { axis: 'x', offset: 150 }, // real cut
    ]);
    expect(estimatePartCount(planes, bounds)).toBe(2);
  });
});

describe('fitReport', () => {
  const bounds = { min: { x: 0, y: 0, z: 0 }, max: { x: 300, y: 300, z: 300 } };
  const printer = { x: 250, y: 210, z: 220 };

  it('flags every axis when the whole model is uncut', () => {
    const r = fitReport([], bounds, printer);
    expect(r.fits).toBe(false);
    expect(r.over).toEqual({ x: true, y: true, z: true });
    expect(r.maxCell).toEqual({ x: 300, y: 300, z: 300 });
    expect(r.usable).toEqual({ x: 248, y: 208, z: 218 });
  });

  it('passes once the widest gap on every axis fits', () => {
    // One central plane per axis -> 150mm slabs, all under usable size.
    const planes = manualToPlanes([
      { axis: 'x', offset: 150 },
      { axis: 'y', offset: 150 },
      { axis: 'z', offset: 150 },
    ]);
    const r = fitReport(planes, bounds, printer);
    expect(r.fits).toBe(true);
    expect(r.maxCell).toEqual({ x: 150, y: 150, z: 150 });
  });

  it('uses the widest gap, not the average', () => {
    // Cut x near one end: gaps 40 and 260; 260 > 248 usable -> still too big.
    const planes = manualToPlanes([{ axis: 'x', offset: 40 }]);
    const r = fitReport(planes, bounds, printer);
    expect(r.maxCell.x).toBe(260);
    expect(r.over.x).toBe(true);
    expect(r.fits).toBe(false);
  });

  it('respects the margin', () => {
    // A single plane leaving exactly 248mm on x fits with the default 2mm margin.
    const planes = manualToPlanes([{ axis: 'x', offset: 52 }]); // gaps 52 and 248
    const r = fitReport(planes, bounds, printer);
    expect(r.maxCell.x).toBe(248);
    expect(r.over.x).toBe(false);
  });
});
