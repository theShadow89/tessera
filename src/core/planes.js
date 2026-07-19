// Helpers for working with axis-aligned cut planes, shared by the auto grid and
// the manual editor. A "manual plane" is {axis:'x'|'y'|'z', offset:number}; the
// cutter and connector engine consume {normal:[x,y,z], offset:number}.

export const AXES = ['x', 'y', 'z'];

const AXIS_NORMAL = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};

/** Axis letter for a unit axis-aligned normal. */
export function axisOfNormal(normal) {
  if (normal[0]) return 'x';
  if (normal[1]) return 'y';
  return 'z';
}

/** Convert manual planes to the {normal, offset} form the cutter expects. */
export function manualToPlanes(manualPlanes) {
  return manualPlanes.map((p) => ({ normal: AXIS_NORMAL[p.axis], offset: p.offset }));
}

/** Seed manual planes from cutter planes (e.g. the auto grid result). */
export function planesToManual(planes) {
  return planes.map((p) => ({ axis: axisOfNormal(p.normal), offset: p.offset }));
}

/**
 * Parts a set of full axis-aligned planes produces. Each plane spans the model,
 * so the count is the product over axes of (planes on that axis + 1). Planes on
 * or outside the model bounds are ignored when bounds are given (they cut nothing).
 *
 * @param {Array<{normal:number[], offset:number}>} planes
 * @param {{min:object, max:object}} [bounds] optional model bounds to ignore no-op planes
 * @returns {number}
 */
export function estimatePartCount(planes, bounds) {
  const perAxis = { x: 0, y: 0, z: 0 };
  for (const p of planes) {
    const axis = axisOfNormal(p.normal);
    if (bounds && (p.offset <= bounds.min[axis] || p.offset >= bounds.max[axis])) continue;
    perAxis[axis]++;
  }
  return (perAxis.x + 1) * (perAxis.y + 1) * (perAxis.z + 1);
}

/**
 * Check whether the parts produced by a plane set fit the printer. Each part's
 * size on an axis is a gap between consecutive cut offsets (or the model edge),
 * so the largest part on an axis is the widest such gap. If any axis's widest
 * gap exceeds the usable build size, some part will not fit.
 *
 * Auto grids always fit by construction; this matters for manually placed planes.
 *
 * @param {Array<{normal:number[], offset:number}>} planes
 * @param {{min:object, max:object}} bounds model bounds (mm)
 * @param {{x:number, y:number, z:number}} printer usable build volume (mm)
 * @param {number} margin safety gap subtracted per axis (mm)
 * @returns {{fits:boolean, maxCell:{x,y,z}, over:{x:boolean,y:boolean,z:boolean}, usable:{x,y,z}}}
 */
export function fitReport(planes, bounds, printer, margin = 2) {
  const maxCell = {};
  const over = {};
  const usable = {};
  let fits = true;
  for (const axis of AXES) {
    const edges = [bounds.min[axis], bounds.max[axis]];
    for (const p of planes) {
      if (axisOfNormal(p.normal) !== axis) continue;
      if (p.offset > bounds.min[axis] && p.offset < bounds.max[axis]) edges.push(p.offset);
    }
    edges.sort((a, b) => a - b);
    let gap = 0;
    for (let i = 1; i < edges.length; i++) gap = Math.max(gap, edges[i] - edges[i - 1]);
    const u = Math.max(0, printer[axis] - margin);
    maxCell[axis] = gap;
    usable[axis] = u;
    over[axis] = gap > u;
    if (over[axis]) fits = false;
  }
  return { fits, maxCell, over, usable };
}
