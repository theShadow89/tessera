// Headless smoke test of the manifold CSG core (mirrors manifoldWorker.js).
// Builds a 300mm box, plans a grid for a 250x210x220 printer, cuts, and checks
// that every part is a valid closed manifold that fits the volume.
import Module from 'manifold-3d';
import { planGrid, partCount } from '../src/core/partition.js';

const wasm = await Module();
wasm.setup();
const { Manifold, Mesh } = wasm;

// A 300x300x300 box as an indexed triangle mesh, min corner at origin.
function boxMesh(sx, sy, sz) {
  const v = [
    [0, 0, 0], [sx, 0, 0], [sx, sy, 0], [0, sy, 0],
    [0, 0, sz], [sx, 0, sz], [sx, sy, sz], [0, sy, sz],
  ];
  const faces = [
    [0, 2, 1], [0, 3, 2], // bottom (-z)
    [4, 5, 6], [4, 6, 7], // top (+z)
    [0, 1, 5], [0, 5, 4], // -y
    [1, 2, 6], [1, 6, 5], // +x
    [2, 3, 7], [2, 7, 6], // +y
    [3, 0, 4], [3, 4, 7], // -x
  ];
  return {
    vertProperties: new Float32Array(v.flat()),
    triVerts: new Uint32Array(faces.flat()),
  };
}

const S = 300;
const input = boxMesh(S, S, S);
const bbox = { min: { x: 0, y: 0, z: 0 }, max: { x: S, y: S, z: S } };
const printer = { x: 250, y: 210, z: 220 };

const plan = planGrid(bbox, printer);
console.log('divisions', plan.divisions, 'planes', plan.planes.length, 'expected parts', partCount(plan.divisions));

const root = new Manifold(new Mesh({ numProp: 3, ...input }));
if (root.status() !== 'NoError') throw new Error(`bad input: ${root.status()}`);

let frags = [root];
for (const plane of plan.planes) {
  const next = [];
  for (const f of frags) {
    const [a, b] = f.splitByPlane(plane.normal, plane.offset);
    if (a.numTri() > 0) next.push(a); else a.delete();
    if (b.numTri() > 0) next.push(b); else b.delete();
  }
  for (const f of frags) f.delete();
  frags = next;
}

let totalVol = 0;
let ok = true;
for (const [i, f] of frags.entries()) {
  const status = f.status();
  const box = f.boundingBox();
  const dim = {
    x: box.max[0] - box.min[0],
    y: box.max[1] - box.min[1],
    z: box.max[2] - box.min[2],
  };
  const fits = dim.x <= printer.x && dim.y <= printer.y && dim.z <= printer.z;
  totalVol += f.volume();
  if (status !== 'NoError' || !fits) ok = false;
  console.log(`part ${i + 1}: status=${status} dim=${dim.x.toFixed(0)}x${dim.y.toFixed(0)}x${dim.z.toFixed(0)} fits=${fits}`);
}

const expectedVol = S * S * S;
const volOk = Math.abs(totalVol - expectedVol) / expectedVol < 1e-6;
console.log(`parts=${frags.length} expected=${partCount(plan.divisions)} volume=${totalVol.toFixed(0)} (expected ${expectedVol}) conserved=${volOk}`);

if (!ok || frags.length !== partCount(plan.divisions) || !volOk) {
  console.error('SMOKE TEST FAILED');
  process.exit(1);
}
console.log('SMOKE TEST PASSED');
