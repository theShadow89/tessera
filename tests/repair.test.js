import { describe, it, expect } from 'vitest';
import { repairMesh } from '../src/geometry/repair.js';

// A closed unit cube (8 verts, 12 triangles), consistent outward winding.
const CUBE_VERTS = new Float32Array([
  0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
  0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,
]);
const CUBE_TRIS = [
  [0, 2, 1], [0, 3, 2], // bottom (-z)
  [4, 5, 6], [4, 6, 7], // top (+z)
  [0, 1, 5], [0, 5, 4], // -y
  [1, 2, 6], [1, 6, 5], // +x
  [2, 3, 7], [2, 7, 6], // +y
  [3, 0, 4], [3, 4, 7], // -x
];

function flat(tris) {
  return new Uint32Array(tris.flat());
}

describe('repairMesh', () => {
  it('leaves a already-closed mesh unchanged', () => {
    const r = repairMesh(CUBE_VERTS, flat(CUBE_TRIS));
    expect(r.report.changed).toBe(false);
    expect(r.report.holesFilled).toBe(0);
    expect(r.report.degenerateRemoved).toBe(0);
    expect(r.report.boundaryEdgesBefore).toBe(0);
    expect(r.report.nonManifoldEdges).toBe(0);
    expect(r.triVerts.length).toBe(CUBE_TRIS.length * 3);
  });

  it('fills a single-hole mesh (cube missing the top two triangles)', () => {
    // Remove the two +z triangles -> a square hole with a 4-edge boundary loop.
    const open = CUBE_TRIS.filter((_, i) => i !== 2 && i !== 3);
    const r = repairMesh(CUBE_VERTS, flat(open));
    expect(r.report.boundaryEdgesBefore).toBe(4);
    expect(r.report.holesFilled).toBe(1);
    expect(r.report.trianglesAdded).toBe(2); // a fan over a 4-vertex loop
    expect(r.report.changed).toBe(true);
    // Back to 12 triangles, and no boundary edges remain.
    const und = new Map();
    const key = (u, v) => (u < v ? `${u},${v}` : `${v},${u}`);
    for (let i = 0; i < r.triVerts.length; i += 3) {
      const [a, b, c] = [r.triVerts[i], r.triVerts[i + 1], r.triVerts[i + 2]];
      for (const [u, v] of [[a, b], [b, c], [c, a]]) und.set(key(u, v), (und.get(key(u, v)) || 0) + 1);
    }
    expect([...und.values()].every((n) => n === 2)).toBe(true);
  });

  it('removes degenerate triangles (repeated index and zero area)', () => {
    const withBad = [...CUBE_TRIS, [0, 0, 1], [0, 1, 1]]; // repeated-index + colinear
    const r = repairMesh(CUBE_VERTS, flat(withBad));
    expect(r.report.degenerateRemoved).toBe(2);
    expect(r.report.changed).toBe(true);
  });

  it('reports non-manifold edges without crashing', () => {
    // Add a spurious triangle sharing edge 0-1, making it used by 3 faces.
    const nm = [...CUBE_TRIS, [0, 1, 4]];
    const r = repairMesh(CUBE_VERTS, flat(nm));
    expect(r.report.nonManifoldEdges).toBeGreaterThanOrEqual(1);
  });
});
