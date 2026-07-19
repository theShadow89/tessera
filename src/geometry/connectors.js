// Alignment-pin connectors: at each cut plane, add a peg to one mating part and
// a matching (oversized) socket to the other, so the parts realign and locate
// when glued back together. Pure module, no worker/UI dependencies, so it can be
// unit-tested and driven by any orchestrator (the WASM worker, the smoke script,
// or a future agent).
//
// Geometry convention (matches Manifold.splitByPlane): a split by plane
// {normal n, offset d} yields [above, below] where "above" is the +n side and
// "below" is the -n side. We give the peg to "below" (so it protrudes across the
// plane into the +n region) and cut the socket from "above". On reassembly the
// peg from the -n part enters the socket in the +n part.

// Circular segments per pin. Enough for a smooth, printable cylinder without
// bloating triangle counts.
const PIN_SEGMENTS = 32;

// Minimum volume change (mm^3) a peg union / socket subtract must produce to be
// considered as actually touching material. Below this the pin missed the part
// (e.g. a centroid falling outside a concave cross-section) and is skipped so we
// never emit a floating peg or a cosmetic socket.
const MIN_EFFECT = 1e-3;

/**
 * Euler angles (degrees, applied X-Y-Z) that rotate the +Z axis onto a unit
 * axis-aligned normal. The pin cylinder is symmetric about its centre, so only
 * the axis matters, not the sign of the normal.
 *
 * MVP limitation: the grid partitioner emits only axis-aligned planes, so only
 * those are supported. An oblique normal falls back to the dominant axis, which
 * would misalign the pin; callers must not feed oblique planes yet.
 *
 * @param {[number,number,number]} n unit normal
 * @returns {[number,number,number]} euler degrees for Manifold.rotate
 */
function eulerAlignZTo(n) {
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  if (ax >= ay && ax >= az) return [0, 90, 0]; // +Z -> X
  if (ay >= ax && ay >= az) return [-90, 0, 0]; // +Z -> Y
  return [0, 0, 0]; // +Z -> Z (no rotation)
}

/**
 * Pin centre points on the cut plane, kept a safe distance from the interface
 * edges so a socket never breaks or over-thins the outer wall.
 *
 * Pins line up along the longer in-plane axis (max lever arm against rotation)
 * and are centred on the shorter axis. Every centre stays at least `margin` from
 * each edge; the outermost pins sit exactly at that inset, so N pins span the
 * usable band `[min+margin, max-margin]`. The count is reduced if centre-to-
 * centre spacing would drop below `minPitch` (which would merge or wall-thin
 * adjacent sockets). If the face is too small to hold even one pin with safe
 * walls on all sides, no pins are placed (empty result).
 *
 * @param {number} axis index (0,1,2) of the plane normal's axis
 * @param {number} offset plane coordinate along that axis
 * @param {{min:number[], max:number[]}} bbox interface bounding box
 * @param {number} count requested pins (>= 1)
 * @param {number} margin min distance from a pin centre to an edge (mm)
 * @param {number} minPitch min centre-to-centre spacing between pins (mm)
 * @returns {Array<[number,number,number]>} pin centres in model space
 */
export function pinCenters(axis, offset, bbox, count, margin = 0, minPitch = 0) {
  const inPlane = [0, 1, 2].filter((i) => i !== axis);
  const extent = inPlane.map((i) => bbox.max[i] - bbox.min[i]);
  const longIdx = extent[0] >= extent[1] ? 0 : 1;
  const shortIdx = longIdx === 0 ? 1 : 0;
  const longAxis = inPlane[longIdx];
  const shortAxis = inPlane[shortIdx];
  const longLen = extent[longIdx];
  const shortLen = extent[shortIdx];
  const shortMid = (bbox.min[shortAxis] + bbox.max[shortAxis]) / 2;

  // Both in-plane edges must leave room for a pin centred with safe walls.
  if (longLen < 2 * margin || shortLen < 2 * margin) return [];

  const usable = longLen - 2 * margin; // band the pin centres may occupy
  let n = Math.max(1, Math.floor(count) || 1);
  if (n > 1 && minPitch > 0) {
    const maxByPitch = Math.floor(usable / minPitch) + 1;
    n = Math.min(n, Math.max(1, maxByPitch));
  }

  const loEdge = bbox.min[longAxis] + margin;
  const centers = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const c = [0, 0, 0];
    c[axis] = offset;
    c[longAxis] = loEdge + usable * t;
    c[shortAxis] = shortMid;
    centers.push(c);
  }
  return centers;
}

/**
 * A grid of candidate connector positions across the interface, ordered from
 * the centre outward. Every point is inset by `margin` from the edges; the grid
 * step is `step`. The caller tests each candidate against the real material and
 * keeps only those where a connector engages, so connectors land in material
 * even when the interface bounding box is much larger than the actual
 * cross-section (necks, concave or L-shaped faces).
 *
 * @param {number} axis normal axis (0,1,2)
 * @param {number} offset plane coordinate
 * @param {{min:number[], max:number[]}} window interface bbox
 * @param {number} margin edge inset (mm)
 * @param {number} step grid spacing (mm)
 * @returns {Array<[number,number,number]>} candidate points, centre-first
 */
export function candidateGrid(axis, offset, window, margin, step) {
  const inPlane = [0, 1, 2].filter((k) => k !== axis);
  const axisPoints = (k) => {
    const lo = window.min[k] + margin;
    const hi = window.max[k] - margin;
    if (hi <= lo) return [(window.min[k] + window.max[k]) / 2];
    const n = Math.max(1, Math.floor((hi - lo) / Math.max(step, 1e-6)) + 1);
    if (n === 1) return [(lo + hi) / 2];
    const out = [];
    for (let i = 0; i < n; i++) out.push(lo + ((hi - lo) * i) / (n - 1));
    return out;
  };
  const [au, av] = inPlane;
  const us = axisPoints(au);
  const vs = axisPoints(av);
  const cu = (window.min[au] + window.max[au]) / 2;
  const cv = (window.min[av] + window.max[av]) / 2;
  const pts = [];
  for (const u of us) {
    for (const v of vs) {
      const c = [0, 0, 0];
      c[axis] = offset;
      c[au] = u;
      c[av] = v;
      pts.push(c);
    }
  }
  pts.sort((p, q) => Math.hypot(p[au] - cu, p[av] - cv) - Math.hypot(q[au] - cu, q[av] - cv));
  return pts;
}

/**
 * Largest feature radius a connector type uses. Drives edge margin and spacing
 * so no feature (peg, socket, insert hole, screw counterbore, magnet pocket)
 * lands too close to an edge or a neighbour.
 *
 * @param {string} type 'pin' | 'insert' | 'magnet'
 * @param {object} opts connector options
 * @returns {number} radius (mm)
 */
export function connectorMaxRadius(type, opts) {
  if (type === 'magnet') return opts.magnetDiameter / 2 + opts.clearance;
  if (type === 'insert') {
    const counterboreR = (opts.screwDiameter * 1.8) / 2; // head clearance ~1.8x shank
    return Math.max(opts.insertDiameter / 2, counterboreR);
  }
  if (type === 'dovetail') return opts.dovetailWidth / 2 + opts.clearance;
  // pin
  return opts.pinDiameter / 2 + opts.clearance;
}

/**
 * A dovetail tail: a trapezoidal prism straddling the cut plane. Built as an
 * axis-aligned box deformed with warp() so its width along the in-plane `vAxis`
 * grows from `neck` (at the near face) to `base` (at the far face). The flare
 * locks the joint against pull-apart along the normal; the constant profile
 * along the slide axis lets the two printed parts be slid together.
 *
 * @param {object} Manifold
 * @param {{axis:number, vAxis:number, center:number[], slideLen:number,
 *          depth:number, neck:number, base:number}} p
 * @returns {object} manifold
 */
function dovetailSolid(Manifold, p) {
  const { axis, vAxis, center, slideLen, depth, neck, base } = p;
  const slide = [0, 1, 2].find((k) => k !== axis && k !== vAxis);
  const size = [0, 0, 0];
  size[axis] = 2 * depth;
  size[slide] = slideLen;
  size[vAxis] = base;

  const cube = Manifold.cube(size, true);
  const placed = cube.translate(center);
  cube.delete();
  const lo = center[axis] - depth;
  const warped = placed.warp((v) => {
    const t = (v[axis] - lo) / (2 * depth); // 0 at near face, 1 at far face
    const wfac = (neck + (base - neck) * t) / base;
    v[vAxis] = center[vAxis] + (v[vAxis] - center[vAxis]) * wfac;
  });
  placed.delete();
  return warped;
}

/**
 * Per-connector-type feature specs at one interface point. Each spec is a
 * cylinder along the cut normal, given as a signed span [from, to] relative to
 * the plane (0 at the plane, + on the "above" side), a radius, the target part,
 * and whether it adds or subtracts material.
 *
 * Conventions: "below" is the -n part, "above" the +n part.
 * - pin: a peg on below straddling the plane, a matching oversized socket in above.
 * - insert: a blind hole in below for a heat-set threaded insert; a through screw
 *   clearance hole in above with a counterbore at its outer face for the head.
 * - magnet: a blind cylindrical pocket on each side, meeting at the plane.
 *
 * @param {string} type
 * @param {object} opts
 * @param {number} aboveEnd distance from the plane to above's outer face (mm)
 * @param {number} belowEnd distance from the plane to below's outer face (mm)
 * @returns {Array<{side:'above'|'below', kind:'add'|'sub', radius:number, from:number, to:number}>}
 */
function connectorFeatures(type, opts, aboveEnd, belowEnd) {
  if (type === 'magnet') {
    const r = opts.magnetDiameter / 2 + opts.clearance;
    const d = Math.min(opts.magnetThickness, aboveEnd, belowEnd);
    return [
      { side: 'below', kind: 'sub', radius: r, from: -d, to: 0 },
      { side: 'above', kind: 'sub', radius: r, from: 0, to: d },
    ];
  }
  if (type === 'insert') {
    const insertR = opts.insertDiameter / 2;
    const insertD = Math.min(opts.insertDepth, belowEnd);
    const screwR = opts.screwDiameter / 2;
    const cbR = (opts.screwDiameter * 1.8) / 2;
    const cbD = opts.screwDiameter;
    return [
      { side: 'below', kind: 'sub', radius: insertR, from: -insertD, to: 0 },
      // Through hole for the screw shank, plus 1mm to guarantee it breaks the face.
      { side: 'above', kind: 'sub', radius: screwR, from: 0, to: aboveEnd + 1 },
      // Counterbore for the head at the outer face.
      { side: 'above', kind: 'sub', radius: cbR, from: aboveEnd - cbD, to: aboveEnd + 1 },
    ];
  }
  // pin
  const r = opts.pinDiameter / 2;
  const L = opts.pinLength;
  return [
    { side: 'below', kind: 'add', radius: r, from: -L, to: L },
    { side: 'above', kind: 'sub', radius: r + opts.clearance, from: -L, to: L },
  ];
}

/**
 * Apply a connector across one final interface. Dispatches on opts.type and
 * places one connector per safe interface point. A connector is committed only
 * if every feature it specifies actually changes its target part's volume;
 * otherwise it is reverted and skipped (so nothing floats or opens the shell).
 *
 * @param {object} Manifold manifold class from the wasm module (for cylinder)
 * @param {object} above +n side manifold
 * @param {object} below -n side manifold
 * @param {{normal:[number,number,number], offset:number}} plane cut plane
 * @param {{min:number[], max:number[]}} window interface placement window
 * @param {object} opts connector options (see App state)
 * @param {{min:number[], max:number[]}} aboveBBox bbox of the above part
 * @param {{min:number[], max:number[]}} belowBBox bbox of the below part
 * @returns {{above:object, below:object}} modified parts (originals freed when changed)
 */
export function applyConnectors(Manifold, above, below, plane, window, opts, aboveBBox, belowBBox) {
  const type = opts.type;
  if (type !== 'pin' && type !== 'insert' && type !== 'magnet' && type !== 'dovetail') {
    return { above, below };
  }

  const axis = axisOf(plane.normal);
  const offset = plane.offset;

  // Dovetail is a single sliding joint per interface, not a row of cylinders.
  if (type === 'dovetail') {
    const inPlane = [0, 1, 2].filter((k) => k !== axis);
    const ext = inPlane.map((k) => window.max[k] - window.min[k]);
    const longIdx = ext[0] >= ext[1] ? 0 : 1;
    const slideAxis = inPlane[longIdx];
    const vAxis = inPlane[longIdx === 0 ? 1 : 0];
    const minWall = Math.max(0, opts.minWall || 0);
    const clr = opts.clearance;
    const base = opts.dovetailWidth;
    const neck = opts.dovetailNeck;
    const depth = opts.dovetailDepth;

    // The face must hold the tail plus a wall on each side, and be long enough
    // to slide. Otherwise skip (leave the interface plain).
    if (base + 2 * (clr + minWall) > ext[longIdx === 0 ? 1 : 0] || ext[longIdx] < 2 * minWall + 10) {
      return { above, below };
    }
    const slideLen = ext[longIdx] - 2 * minWall;
    const center = [0, 0, 0];
    center[axis] = offset;
    center[slideAxis] = (window.min[slideAxis] + window.max[slideAxis]) / 2;
    center[vAxis] = (window.min[vAxis] + window.max[vAxis]) / 2;

    const male = dovetailSolid(Manifold, { axis, vAxis, center, slideLen, depth, neck, base });
    const female = dovetailSolid(Manifold, {
      axis,
      vAxis,
      center,
      slideLen: slideLen + 2 * clr,
      depth: depth + clr,
      neck: neck + 2 * clr,
      base: base + 2 * clr,
    });
    const nextBelow = below.add(male);
    const nextAbove = above.subtract(female);
    male.delete();
    female.delete();

    const ok =
      Math.abs(nextBelow.volume() - below.volume()) > MIN_EFFECT &&
      Math.abs(nextAbove.volume() - above.volume()) > MIN_EFFECT;
    if (!ok) {
      nextBelow.delete();
      nextAbove.delete();
      return { above, below };
    }
    below.delete();
    above.delete();
    return { above: nextAbove, below: nextBelow };
  }

  const euler = eulerAlignZTo(plane.normal);
  const maxR = connectorMaxRadius(type, opts);
  const minWall = Math.max(0, opts.minWall || 0);
  const margin = maxR + minWall;
  const minPitch = 2 * maxR + minWall;

  const inPlane = [0, 1, 2].filter((k) => k !== axis);
  const longExtent = Math.max(...inPlane.map((k) => window.max[k] - window.min[k]));
  const count = opts.autoPins
    ? autoPinCount(longExtent, maxR * 2)
    : Math.max(1, Math.floor(opts.pinsPerJoint) || 1);

  const aboveEnd = aboveBBox.max[axis] - offset;
  const belowEnd = offset - belowBBox.min[axis];

  // Cylinder along the normal spanning [from, to] (relative to the plane) at c.
  const cyl = (radius, from, to, c) => {
    const length = to - from;
    const base = Manifold.cylinder(length, radius, radius, PIN_SEGMENTS, true);
    const rotated = base.rotate(euler);
    base.delete();
    const t = c.slice();
    t[axis] += (from + to) / 2;
    const placed = rotated.translate(t);
    rotated.delete();
    return placed;
  };

  // Test candidate points against the real material and keep those where the
  // connector engages, spaced by minPitch, up to `count`. Grid resolution is
  // bounded (~6 per axis) and ordered centre-first so solid faces succeed on the
  // first tries and necks get pins where the material actually is.
  const step = Math.max(minPitch, longExtent / 5);
  const candidates = candidateGrid(axis, offset, window, margin, step);

  let curAbove = above;
  let curBelow = below;
  const placed = [];

  for (const c of candidates) {
    if (placed.length >= count) break;
    // Keep connectors apart so their features don't merge or thin the wall.
    if (placed.some((p) => Math.hypot(...inPlane.map((k) => p[k] - c[k])) < minPitch)) continue;

    const features = connectorFeatures(type, opts, aboveEnd, belowEnd);
    let nextAbove = curAbove;
    let nextBelow = curBelow;
    let ownA = false;
    let ownB = false;
    for (const f of features) {
      const solid = cyl(f.radius, f.from, f.to, c);
      if (f.side === 'above') {
        const res = f.kind === 'add' ? nextAbove.add(solid) : nextAbove.subtract(solid);
        if (ownA) nextAbove.delete();
        nextAbove = res;
        ownA = true;
      } else {
        const res = f.kind === 'add' ? nextBelow.add(solid) : nextBelow.subtract(solid);
        if (ownB) nextBelow.delete();
        nextBelow = res;
        ownB = true;
      }
      solid.delete();
    }

    const touchesAbove = features.some((f) => f.side === 'above');
    const touchesBelow = features.some((f) => f.side === 'below');
    const aOk = !touchesAbove || Math.abs(nextAbove.volume() - curAbove.volume()) > MIN_EFFECT;
    const bOk = !touchesBelow || Math.abs(nextBelow.volume() - curBelow.volume()) > MIN_EFFECT;

    if (!aOk || !bOk) {
      // This candidate missed material; discard and try the next one.
      if (ownA) nextAbove.delete();
      if (ownB) nextBelow.delete();
      continue;
    }

    if (ownA) {
      curAbove.delete();
      curAbove = nextAbove;
    }
    if (ownB) {
      curBelow.delete();
      curBelow = nextBelow;
    }
    placed.push(c);
  }

  return { above: curAbove, below: curBelow };
}

// Auto pin-count heuristic. One pin only locates a joint; two collinear pins are
// needed to stop the parts rotating relative to each other, and long faces want
// a few more for strength. Capped so triangle count and pin crowding stay sane.
const AUTO_SPACING = 45; // target centre-to-centre spacing (mm) along the long edge
const AUTO_MAX_PINS = 5;

/**
 * Pins to place on one interface, sized to its longer in-plane edge.
 * Below ~3 pin diameters a second pin would not fit with edge margins, so a
 * single locating pin is used; otherwise at least two (to lock rotation), and
 * one extra per AUTO_SPACING mm up to AUTO_MAX_PINS.
 *
 * @param {number} longExtent  length of the interface's longer in-plane edge (mm)
 * @param {number} pinDiameter (mm)
 * @returns {number} pin count (>= 1)
 */
export function autoPinCount(longExtent, pinDiameter) {
  if (!(longExtent > 0)) return 1;
  if (longExtent < 3 * pinDiameter) return 1;
  return Math.min(AUTO_MAX_PINS, Math.max(2, Math.round(longExtent / AUTO_SPACING)));
}

/** Axis index (0,1,2) of a unit axis-aligned normal. */
function axisOf(n) {
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  if (ax >= ay && ax >= az) return 0;
  if (ay >= az) return 1;
  return 2;
}

/**
 * Group cut-plane offsets by axis, ascending. The grid partitioner emits only
 * axis-aligned planes, so every plane maps to exactly one axis.
 *
 * @param {Array<{normal:number[], offset:number}>} planes
 * @returns {number[][]} offsets[axis], sorted ascending
 */
function offsetsByAxis(planes) {
  const offsets = [[], [], []];
  for (const p of planes) offsets[axisOf(p.normal)].push(p.offset);
  offsets.forEach((o) => o.sort((a, b) => a - b));
  return offsets;
}

/**
 * Grid cell index (i,j,k) of a point: on each axis, how many cut offsets lie
 * below the point. Because the cuts are an arrangement of axis-aligned planes,
 * every final part occupies exactly one such cell, so its bbox centre yields a
 * stable, unique index.
 *
 * @param {[number,number,number]} center
 * @param {number[][]} offsets  offsetsByAxis result
 * @returns {[number,number,number]}
 */
function cellIndex(center, offsets) {
  return [0, 1, 2].map((a) => {
    let i = 0;
    for (const o of offsets[a]) {
      if (center[a] > o) i++;
      else break;
    }
    return i;
  });
}

/**
 * Add alignment pins per final interface, after all cutting is done.
 *
 * This is the correct placement strategy: pins are added between exactly the two
 * final parts that share an interface, so a pin can never be sliced by a later
 * cut or shared across more than two parts (the failure mode of adding pins
 * during the recursive split).
 *
 * The partition is an axis-aligned grid, so adjacency is analytic: two parts are
 * neighbours when their cell indices differ by 1 on a single axis. The shared
 * interface lies on the separating plane, within the overlap of the two parts'
 * cross-sections. Each part is mutated in place (its manifold reference replaced)
 * as it participates in up to six interfaces; addPins frees the manifolds it
 * supersedes.
 *
 * @param {object} Manifold  manifold class from the wasm module
 * @param {object[]} parts   final cut parts (manifolds), grid-aligned
 * @param {Array<{normal:number[], offset:number}>} planes  the cut planes
 * @param {{clearance:number, pinDiameter:number, pinLength:number, pinsPerJoint:number}} opts
 * @returns {{parts:object[], interfaces:number, interfacesPinned:number}}
 *   parts: the mutated part manifolds (same array length/order);
 *   interfaces: adjacent pairs found; interfacesPinned: pairs where a pin
 *   actually engaged material.
 */
export function addInterfacePins(Manifold, parts, planes, opts) {
  const offsets = offsetsByAxis(planes);
  const bboxes = parts.map((p) => p.boundingBox());
  const centers = bboxes.map((b) => [
    (b.min[0] + b.max[0]) / 2,
    (b.min[1] + b.max[1]) / 2,
    (b.min[2] + b.max[2]) / 2,
  ]);
  const cells = centers.map((c) => cellIndex(c, offsets));
  const keyOf = (idx) => idx.join(',');
  const cellToPart = new Map();
  cells.forEach((idx, i) => cellToPart.set(keyOf(idx), i));

  const axisNormal = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const current = parts.slice();
  let interfaces = 0;
  let interfacesPinned = 0;

  for (let i = 0; i < parts.length; i++) {
    const idx = cells[i];
    for (let a = 0; a < 3; a++) {
      const neighbor = idx.slice();
      neighbor[a] += 1;
      const j = cellToPart.get(keyOf(neighbor));
      if (j === undefined) continue;
      const off = offsets[a][idx[a]];
      if (off === undefined) continue;
      interfaces++;

      // Placement window: intersection of the two parts' cross-sections, from
      // their clean bounding boxes (stable, unaffected by pegs added earlier).
      const bi = bboxes[i];
      const bj = bboxes[j];
      const window = {
        min: [0, 1, 2].map((k) => Math.max(bi.min[k], bj.min[k])),
        max: [0, 1, 2].map((k) => Math.min(bi.max[k], bj.max[k])),
      };
      const plane = { normal: axisNormal[a], offset: off };

      // Lower index i is on the -n side (below), neighbour j on +n (above).
      const before = current[i].volume() + current[j].volume();
      const joined = applyConnectors(Manifold, current[j], current[i], plane, window, opts, bj, bi);
      current[j] = joined.above;
      current[i] = joined.below;
      const after = current[i].volume() + current[j].volume();
      if (Math.abs(after - before) > MIN_EFFECT) interfacesPinned++;
    }
  }

  return { parts: current, interfaces, interfacesPinned };
}
