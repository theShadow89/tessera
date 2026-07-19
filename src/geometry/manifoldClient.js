// Promise-based wrapper around the manifold Web Worker.
let worker = null;
let nextId = 1;
const pending = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./manifoldWorker.js', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (e) => {
      const { id, ok, error } = e.data;
      const resolver = pending.get(id);
      if (!resolver) return;
      pending.delete(id);
      if (ok) resolver.resolve(e.data);
      else resolver.reject(new Error(error));
    };
    worker.onerror = (e) => {
      // Fail all in-flight requests on a fatal worker error.
      for (const { reject } of pending.values()) {
        reject(new Error(`Worker crashed: ${e.message}`));
      }
      pending.clear();
    };
  }
  return worker;
}

/**
 * Cut a mesh along the given planes inside the worker.
 *
 * @param {{vertProperties:Float32Array, triVerts:Uint32Array}} mesh
 * @param {Array<{normal:number[], offset:number}>} planes
 * @param {object} [connectors] connector options; omitted or type 'none' cuts without connectors
 * @param {boolean} [repair] repair the mesh (weld/fill holes) before cutting
 * @param {{printer:{x,y,z}, margin?:number}} [optimize] when set, move each cut
 *   to the narrowest cross-section that still fits (keeps the cut count)
 * @returns {Promise<Array<{vertProperties:Float32Array, triVerts:Uint32Array}>>}
 */
export function cutMesh(mesh, planes, connectors, repair = false, optimize = null) {
  const w = getWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage(
      { id, type: 'cut', payload: { ...mesh, planes, connectors, repair, optimize } },
      [mesh.vertProperties.buffer, mesh.triVerts.buffer]
    );
  }).then((data) => data.parts);
}

/**
 * Analyse a mesh: is it a valid manifold (optionally after repair), and what did
 * repair do. Used at import to tell the user whether the model is printable.
 *
 * @param {{vertProperties:Float32Array, triVerts:Uint32Array}} mesh
 * @param {boolean} [repair]
 * @returns {Promise<{manifold:boolean, status:string, volume:number, report:object|null}>}
 */
export function analyzeMesh(mesh, repair = false) {
  const w = getWorker();
  const id = nextId++;
  // Copy the buffers: analyze must not consume the caller's arrays (they are
  // still needed for the later cut).
  const vp = mesh.vertProperties.slice();
  const tv = mesh.triVerts.slice();
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage(
      { id, type: 'analyze', payload: { vertProperties: vp, triVerts: tv, repair } },
      [vp.buffer, tv.buffer]
    );
  }).then((data) => data.analysis);
}
