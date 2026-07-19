/**
 * Decide how many pieces a model must be cut into to fit a printer, and where
 * the cut planes go. MVP strategy: axis-aligned grid. For each axis, if the
 * model is longer than the printer's usable size, split it into the minimum
 * number of equal slabs that fit, placing evenly spaced planes.
 *
 * All units are millimetres in model space.
 */

/**
 * @param {{min:{x,y,z}, max:{x,y,z}}} bbox  model bounding box (three.js Box3-like)
 * @param {{x:number, y:number, z:number}} printer  usable build volume
 * @param {number} margin  safety gap subtracted from each printer axis (mm)
 * @returns {{
 *   planes: Array<{normal:number[], offset:number}>,
 *   divisions: {x:number, y:number, z:number},
 *   fits: boolean
 * }}
 */
export function planGrid(bbox, printer, margin = 2) {
  const size = {
    x: bbox.max.x - bbox.min.x,
    y: bbox.max.y - bbox.min.y,
    z: bbox.max.z - bbox.min.z,
  };
  const usable = {
    x: Math.max(1, printer.x - margin),
    y: Math.max(1, printer.y - margin),
    z: Math.max(1, printer.z - margin),
  };

  const divisions = {
    x: Math.max(1, Math.ceil(size.x / usable.x)),
    y: Math.max(1, Math.ceil(size.y / usable.y)),
    z: Math.max(1, Math.ceil(size.z / usable.z)),
  };

  const planes = [];
  const axes = [
    { key: 'x', normal: [1, 0, 0], lo: bbox.min.x, len: size.x },
    { key: 'y', normal: [0, 1, 0], lo: bbox.min.y, len: size.y },
    { key: 'z', normal: [0, 0, 1], lo: bbox.min.z, len: size.z },
  ];

  for (const axis of axes) {
    const n = divisions[axis.key];
    for (let i = 1; i < n; i++) {
      const offset = axis.lo + (axis.len * i) / n;
      planes.push({ normal: axis.normal, offset });
    }
  }

  const fits = divisions.x === 1 && divisions.y === 1 && divisions.z === 1;
  return { planes, divisions, fits };
}

/** Number of parts a division map produces. */
export function partCount(divisions) {
  return divisions.x * divisions.y * divisions.z;
}
