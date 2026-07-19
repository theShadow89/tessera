import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { zipStore } from './zip.js';

/**
 * Export the selected parts. One part downloads as a plain binary STL; several
 * download as a single ZIP (browsers block multiple back-to-back downloads, so
 * one file per click is the reliable path). Parts keep their world position so
 * they reassemble when imported together.
 *
 * @param {THREE.BufferGeometry[]} geometries all cut parts
 * @param {number[]} indices which parts to export (into geometries)
 * @param {string} baseName filename stem, e.g. "bracket"
 */
export function exportParts(geometries, indices, baseName = 'tessera') {
  const exporter = new STLExporter();
  const files = indices.map((i) => {
    const mesh = new THREE.Mesh(geometries[i]);
    const view = exporter.parse(mesh, { binary: true }); // DataView
    const data = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    return { name: `${baseName}_part${String(i + 1).padStart(2, '0')}.stl`, data };
  });

  if (files.length === 0) return;
  if (files.length === 1) {
    downloadBlob(new Blob([files[0].data], { type: 'model/stl' }), files[0].name);
    return;
  }
  const zip = zipStore(files);
  downloadBlob(new Blob([zip], { type: 'application/zip' }), `${baseName}_parts.zip`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after a tick so the download can start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
