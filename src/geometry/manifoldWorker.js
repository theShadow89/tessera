// Web Worker: all heavy CSG runs here so the UI thread never blocks.
// Loads the manifold-3d WASM module once, then handles cut requests.
import Module from 'manifold-3d';
import { addInterfacePins } from './connectors.js';
import { repairMesh } from './repair.js';
import { optimalCutOffsets } from '../core/optimize.js';

let wasm = null;

const OPT_SAMPLES = 18; // cross-section probes per cut axis (cost vs quality)

/** Axis index of a unit axis-aligned normal. */
function normalAxis(n) {
  return n[0] ? 0 : n[1] ? 1 : 2;
}

/**
 * Seam-aware cut placement: keep the per-axis cut COUNT from `planes` but move
 * each cut to where the model's cross-section is smallest, subject to the
 * printer fit. Cross-section area at a plane is derived from the surface-area
 * jump a split produces: A = (SA(above) + SA(below) - SA(whole)) / 2.
 *
 * @returns {Array<{normal:number[], offset:number}>} optimized planes
 */
function optimizePlanes(root, planes, printer, margin) {
  const box = root.boundingBox();
  const rootSA = root.surfaceArea();
  const axisNormal = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const byAxis = [[], [], []];
  for (const p of planes) byAxis[normalAxis(p.normal)].push(p);

  const out = [];
  for (let a = 0; a < 3; a++) {
    const count = byAxis[a].length;
    if (count === 0) continue;
    const lo = box.min[a];
    const hi = box.max[a];
    const usable = Math.max(1, (a === 0 ? printer.x : a === 1 ? printer.y : printer.z) - margin);

    // Sample cross-section area at evenly spaced interior positions.
    const candidates = [];
    for (let i = 1; i <= OPT_SAMPLES; i++) {
      const pos = lo + ((hi - lo) * i) / (OPT_SAMPLES + 1);
      const [above, below] = root.splitByPlane(axisNormal[a], pos);
      const area = (above.surfaceArea() + below.surfaceArea() - rootSA) / 2;
      above.delete();
      below.delete();
      candidates.push({ pos, area });
    }

    const offsets = optimalCutOffsets(lo, hi, usable, candidates);
    for (const offset of offsets) out.push({ normal: axisNormal[a], offset });
  }
  return out;
}

async function getWasm() {
  if (!wasm) {
    wasm = await Module();
    wasm.setup();
  }
  return wasm;
}

/**
 * Split a manifold repeatedly along a list of axis-aligned planes.
 * Each plane splits every current fragment into two, producing a grid of parts.
 * This is a clean cut only; connectors are added afterwards per final interface
 * (see addInterfacePins), so a pin is never sliced by a later cut.
 *
 * @param {object} root - the manifold to cut
 * @param {Array<{normal:[number,number,number], offset:number}>} planes
 * @returns {object[]} array of manifolds
 */
function splitByPlanes(root, planes) {
  let fragments = [root];
  for (const plane of planes) {
    const next = [];
    for (const frag of fragments) {
      const [a, b] = frag.splitByPlane(plane.normal, plane.offset);
      // Drop empty fragments (a plane may miss a fragment entirely).
      if (a.numTri() > 0) next.push(a);
      else a.delete();
      if (b.numTri() > 0) next.push(b);
      else b.delete();
    }
    // The originals have been consumed; free their memory.
    for (const frag of fragments) frag.delete();
    fragments = next;
  }
  return fragments;
}

/**
 * Build a manifold from raw arrays, optionally repairing first. Flips winding if
 * the result came out inside-out (negative volume). Returns the manifold (or
 * null if still invalid) plus status and the repair report.
 */
function buildRoot(w, vertProperties, triVerts, repair) {
  const { Manifold, Mesh } = w;
  let vp = vertProperties;
  let tv = triVerts;
  let report = null;
  if (repair) {
    const r = repairMesh(vp, tv);
    vp = r.vertProperties;
    tv = r.triVerts;
    report = r.report;
  }

  // Manifold construction throws (not just sets status) for invalid topology,
  // so treat a throw as "not manifold" rather than letting it escape.
  const make = (indices) => {
    try {
      const m = new Manifold(new Mesh({ numProp: 3, vertProperties: vp, triVerts: indices }));
      return { root: m, status: m.status() };
    } catch (err) {
      return { root: null, status: err.code || err.message || 'NotManifold' };
    }
  };

  let { root, status } = make(tv);
  if (root && status === 'NoError' && root.volume() < 0) {
    // Inside-out: reverse every triangle's winding and rebuild.
    const flipped = tv.slice();
    for (let i = 0; i < flipped.length; i += 3) {
      const t = flipped[i + 1];
      flipped[i + 1] = flipped[i + 2];
      flipped[i + 2] = t;
    }
    root.delete();
    ({ root, status } = make(flipped));
  }
  return { root, status, report };
}

self.onmessage = async (e) => {
  const { id, type, payload } = e.data;
  try {
    if (type === 'analyze') {
      const { vertProperties, triVerts, repair } = payload;
      const w = await getWasm();
      const { root, status, report } = buildRoot(w, vertProperties, triVerts, repair);
      const manifold = status === 'NoError' && !!root;
      const volume = manifold ? root.volume() : 0;
      if (root) root.delete();
      self.postMessage({ id, ok: true, analysis: { manifold, status, volume, report } });
      return;
    }

    if (type === 'cut') {
      const { vertProperties, triVerts, planes, connectors, repair, optimize } = payload;
      const w = await getWasm();
      const { Manifold } = w;

      const { root, status } = buildRoot(w, vertProperties, triVerts, repair);
      if (status !== 'NoError' || !root) {
        if (root) root.delete();
        throw new Error(
          `Input is not a valid manifold (${status})` +
            (repair ? ' even after repair' : '') +
            '. It likely has non-manifold edges or self-intersections that need a full repair (planned backend feature).'
        );
      }

      // Seam-aware placement (auto mode only): keep the cut count, move each cut
      // to the narrowest cross-section that still fits the printer.
      let cutPlanes = planes;
      if (optimize && planes.length > 0) {
        cutPlanes = optimizePlanes(root, planes, optimize.printer, optimize.margin ?? 2);
      }

      let fragments = splitByPlanes(root, cutPlanes);
      const withConnectors = connectors && connectors.type && connectors.type !== 'none';
      if (withConnectors && fragments.length > 1) {
        fragments = addInterfacePins(Manifold, fragments, cutPlanes, connectors).parts;
      }

      const parts = fragments.map((frag) => {
        const m = frag.getMesh();
        const out = {
          vertProperties: m.vertProperties,
          triVerts: m.triVerts,
        };
        frag.delete();
        return out;
      });

      // Transfer the underlying buffers to avoid copying large arrays.
      const transfer = [];
      for (const p of parts) {
        transfer.push(p.vertProperties.buffer, p.triVerts.buffer);
      }
      self.postMessage({ id, ok: true, parts }, transfer);
    } else {
      throw new Error(`Unknown message type: ${type}`);
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message || String(err) });
  }
};
