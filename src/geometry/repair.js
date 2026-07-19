// Best-effort mesh repair to turn common broken STL/OBJ meshes into a closed,
// manifold solid the CSG engine will accept. Operates on flat indexed arrays
// (positions already welded by meshBridge) so it is pure and unit-testable.
//
// What it fixes:
//   - degenerate triangles (repeated index or ~zero area)
//   - open holes (boundary-edge loops) via orientation-consistent fan fill
// What it cannot fix (reported, not repaired):
//   - non-manifold edges (shared by >2 triangles), e.g. from self-intersections
//   - non-orientable surfaces
// A proper repair (pymeshlab / MeshFix) is a future backend feature.

const AREA_EPS = 1e-9; // mm^2 below which a triangle is treated as degenerate

function triArea(pos, a, b, c) {
  const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
  const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
  const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  return 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
}

const dkey = (u, v) => `${u},${v}`;
const ukey = (u, v) => (u < v ? `${u},${v}` : `${v},${u}`);

/**
 * Repair a welded indexed mesh.
 *
 * @param {Float32Array} vertProperties flat xyz positions
 * @param {Uint32Array} triVerts flat triangle indices
 * @returns {{
 *   vertProperties: Float32Array,
 *   triVerts: Uint32Array,
 *   report: {
 *     degenerateRemoved: number,
 *     holesFilled: number,
 *     trianglesAdded: number,
 *     boundaryEdgesBefore: number,
 *     nonManifoldEdges: number,
 *     changed: boolean,
 *   }
 * }}
 */
export function repairMesh(vertProperties, triVerts) {
  const pos = vertProperties;
  const report = {
    degenerateRemoved: 0,
    holesFilled: 0,
    trianglesAdded: 0,
    boundaryEdgesBefore: 0,
    nonManifoldEdges: 0,
    changed: false,
  };

  // 1. Drop degenerate triangles.
  const tris = [];
  for (let i = 0; i < triVerts.length; i += 3) {
    const a = triVerts[i];
    const b = triVerts[i + 1];
    const c = triVerts[i + 2];
    if (a === b || b === c || a === c || triArea(pos, a, b, c) < AREA_EPS) {
      report.degenerateRemoved++;
      continue;
    }
    tris.push([a, b, c]);
  }

  // 2. Count edges to find boundary (used once) and non-manifold (used >2) edges.
  const und = new Map();
  for (const [a, b, c] of tris) {
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = ukey(u, v);
      und.set(k, (und.get(k) || 0) + 1);
    }
  }
  for (const cnt of und.values()) {
    if (cnt === 1) report.boundaryEdgesBefore++;
    else if (cnt > 2) report.nonManifoldEdges++;
  }

  // 3. Collect boundary half-edges (directed, as they appear in their triangle)
  //    and chain them into hole loops.
  const boundaryNext = new Map(); // u -> v for the directed boundary edge u->v
  for (const [a, b, c] of tris) {
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      if (und.get(ukey(u, v)) === 1) boundaryNext.set(u, v);
    }
  }

  // 4. Walk each loop once and fill it with a fan. The fan triangles reuse the
  //    reverse of each boundary edge, so orientation stays consistent (each
  //    shared edge ends up with one half-edge in each direction).
  const visited = new Set();
  for (const start of boundaryNext.keys()) {
    if (visited.has(start)) continue;
    const loop = [start];
    visited.add(start);
    let cur = boundaryNext.get(start);
    while (cur !== undefined && cur !== start && !visited.has(cur)) {
      visited.add(cur);
      loop.push(cur);
      cur = boundaryNext.get(cur);
    }
    if (cur === start && loop.length >= 3) {
      for (let i = 1; i < loop.length - 1; i++) {
        tris.push([loop[0], loop[i + 1], loop[i]]);
        report.trianglesAdded++;
      }
      report.holesFilled++;
    }
  }

  report.changed = report.degenerateRemoved > 0 || report.trianglesAdded > 0;

  const outTri = new Uint32Array(tris.length * 3);
  for (let i = 0; i < tris.length; i++) {
    outTri[i * 3] = tris[i][0];
    outTri[i * 3 + 1] = tris[i][1];
    outTri[i * 3 + 2] = tris[i][2];
  }
  return { vertProperties: pos, triVerts: outTri, report };
}
