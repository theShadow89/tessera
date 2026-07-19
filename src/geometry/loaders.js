import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';

/**
 * Load a user-selected file into a single BufferGeometry in millimetres.
 * STL and 3MF are treated as mm (the de-facto printing convention); OBJ is
 * unitless and passed through as-is.
 *
 * @param {File} file
 * @returns {Promise<THREE.BufferGeometry>}
 */
export async function loadModel(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const buffer = await file.arrayBuffer();

  if (ext === 'stl') {
    return new STLLoader().parse(buffer);
  }
  if (ext === 'obj') {
    const text = new TextDecoder().decode(buffer);
    const group = new OBJLoader().parse(text);
    return mergeGroupGeometries(group);
  }
  if (ext === '3mf') {
    const group = new ThreeMFLoader().parse(buffer);
    return mergeGroupGeometries(group);
  }
  throw new Error(`Unsupported file type: .${ext} (use STL, OBJ, or 3MF)`);
}

/** Flatten an Object3D tree into one geometry, baking in world transforms. */
function mergeGroupGeometries(object) {
  const geometries = [];
  object.updateMatrixWorld(true);
  object.traverse((child) => {
    if (child.isMesh && child.geometry) {
      const g = child.geometry.clone();
      g.applyMatrix4(child.matrixWorld);
      // Keep only positions so parts merge cleanly.
      const pos = g.attributes.position;
      const clean = new THREE.BufferGeometry();
      clean.setAttribute('position', pos.clone());
      if (g.index) clean.setIndex(g.index.clone());
      geometries.push(clean.toNonIndexed());
    }
  });
  if (geometries.length === 0) {
    throw new Error('No mesh geometry found in file.');
  }
  return mergePositionGeometries(geometries);
}

/** Concatenate several non-indexed position-only geometries. */
function mergePositionGeometries(geometries) {
  let total = 0;
  for (const g of geometries) total += g.attributes.position.count;
  const merged = new Float32Array(total * 3);
  let offset = 0;
  for (const g of geometries) {
    merged.set(g.attributes.position.array, offset);
    offset += g.attributes.position.array.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(merged, 3));
  return out;
}
