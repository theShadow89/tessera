import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { geometryToManifoldInput, manifoldOutputToGeometry } from '../src/geometry/meshBridge.js';

// A unit quad on the z=0 plane, drawn as two triangles that share an edge.
// Non-indexed, so the shared corners (0,0,0) and (1,1,0) are duplicated: the
// 6 listed vertices only cover 4 distinct positions.
const QUAD_POSITIONS = new Float32Array([
  // triangle 1: v0, v1, v2
  0, 0, 0,
  1, 0, 0,
  1, 1, 0,
  // triangle 2: v0, v2, v3 (v0 and v2 repeat)
  0, 0, 0,
  1, 1, 0,
  0, 1, 0,
]);

function nonIndexedQuad() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(QUAD_POSITIONS.slice(), 3));
  return geo;
}

describe('geometryToManifoldInput', () => {
  it('welds coincident vertices into an indexed mesh', () => {
    const { vertProperties, triVerts } = geometryToManifoldInput(nonIndexedQuad());
    // 6 duplicated corners collapse to 4 unique positions.
    expect(vertProperties.length / 3).toBe(4);
    // Two triangles still reference 3 vertices each.
    expect(triVerts.length).toBe(6);
    // Every index must point at one of the 4 welded vertices.
    for (const i of triVerts) expect(i).toBeLessThan(4);
  });

  it('returns typed arrays of the expected kind', () => {
    const { vertProperties, triVerts } = geometryToManifoldInput(nonIndexedQuad());
    expect(vertProperties).toBeInstanceOf(Float32Array);
    expect(triVerts).toBeInstanceOf(Uint32Array);
  });

  it('drops normals and uvs so only positions survive the weld', () => {
    const geo = nonIndexedQuad();
    // Per-vertex normals that differ between the duplicated corners would block
    // the weld if they leaked through; distinct uvs likewise. Both must be dropped.
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([
      0, 0, 1, 0, 1, 0, 1, 0, 0,
      0, 1, 1, 1, 0, 1, 1, 1, 0,
    ]), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
      0, 0, 1, 0, 1, 1,
      0, 0, 1, 1, 0, 1,
    ]), 2));

    const input = geometryToManifoldInput(geo);
    // Still 4 verts: the differing normals did not prevent welding.
    expect(input.vertProperties.length / 3).toBe(4);
    // The returned shape carries positions and indices only.
    expect(Object.keys(input).sort()).toEqual(['triVerts', 'vertProperties']);
  });
});

describe('manifoldOutputToGeometry', () => {
  it('rebuilds an indexed BufferGeometry with normals and a bounding box', () => {
    const input = geometryToManifoldInput(nonIndexedQuad());
    const geo = manifoldOutputToGeometry(input);

    expect(geo).toBeInstanceOf(THREE.BufferGeometry);

    const position = geo.getAttribute('position');
    expect(position).toBeTruthy();
    expect(position.count).toBe(4); // matches the 4 welded input vertices
    expect(position.itemSize).toBe(3);

    expect(geo.index).toBeTruthy();
    expect(geo.index.count).toBe(6);

    // computeVertexNormals ran.
    expect(geo.getAttribute('normal')).toBeTruthy();
    expect(geo.getAttribute('normal').count).toBe(4);

    // computeBoundingBox ran and reflects the unit quad.
    expect(geo.boundingBox).toBeInstanceOf(THREE.Box3);
    expect(geo.boundingBox.min.toArray()).toEqual([0, 0, 0]);
    expect(geo.boundingBox.max.toArray()).toEqual([1, 1, 0]);
  });
});
