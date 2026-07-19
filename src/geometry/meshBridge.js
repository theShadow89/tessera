import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Convert a three.js BufferGeometry into the flat arrays the manifold worker
 * expects. Manifold requires a manifold (watertight, indexed) mesh, so we merge
 * coincident vertices first and drop everything but positions.
 *
 * @param {THREE.BufferGeometry} geometry
 * @returns {{ vertProperties: Float32Array, triVerts: Uint32Array }}
 */
export function geometryToManifoldInput(geometry) {
  let geo = geometry.clone();
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  // Tolerance-based weld: STL/OBJ exports duplicate every shared vertex.
  geo = mergeVertices(geo, 1e-5);

  if (!geo.index) {
    // mergeVertices always indexes, but guard anyway.
    geo = geo.toNonIndexed();
    throw new Error('Mesh could not be indexed; it is likely not manifold.');
  }

  const vertProperties = new Float32Array(geo.attributes.position.array);
  const triVerts = new Uint32Array(geo.index.array);
  return { vertProperties, triVerts };
}

/**
 * Rebuild a renderable three.js geometry from flat manifold output.
 *
 * @param {{ vertProperties: Float32Array, triVerts: Uint32Array }} part
 * @returns {THREE.BufferGeometry}
 */
export function manifoldOutputToGeometry(part) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(part.vertProperties, 3));
  geo.setIndex(new THREE.BufferAttribute(part.triVerts, 1));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  return geo;
}
