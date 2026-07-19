// Headless smoke test of the alignment-pin connectors (mirrors the worker path).
// Builds a 300mm box, plans a 2x2x2 grid, cuts WITH pin connectors, and checks
// that every part is a valid closed manifold and that pegs/sockets behave:
//   - all parts NoError, non-empty, positive volume (watertight);
//   - total volume is slightly LESS than the no-connector case (sockets remove
//     net material once clearance is accounted for);
//   - at least one part gained volume over its nominal cell (has a peg) and one
//     lost volume (has a socket);
//   - reassembling all parts in world space produces no material overlap, which
//     confirms each peg seats in its neighbour's socket (correct side assignment).
import Module from 'manifold-3d';
import { planGrid, partCount } from '../src/core/partition.js';
import { addInterfacePins, autoPinCount } from '../src/geometry/connectors.js';

const wasm = await Module();
wasm.setup();
const { Manifold, Mesh } = wasm;

function boxMesh(sx, sy, sz) {
  const v = [
    [0, 0, 0], [sx, 0, 0], [sx, sy, 0], [0, sy, 0],
    [0, 0, sz], [sx, 0, sz], [sx, sy, sz], [0, sy, sz],
  ];
  const faces = [
    [0, 2, 1], [0, 3, 2],
    [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4],
    [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6],
    [3, 0, 4], [3, 4, 7],
  ];
  return {
    vertProperties: new Float32Array(v.flat()),
    triVerts: new Uint32Array(faces.flat()),
  };
}

const S = 300;
const bbox = { min: { x: 0, y: 0, z: 0 }, max: { x: S, y: S, z: S } };
const printer = { x: 250, y: 210, z: 220 };
// Exercise the realistic default: auto pin count by interface size. Each 2x2x2
// cube interface is 150x150mm, so autoPinCount(150, 4) pins go on each.
const connectors = { type: 'pin', clearance: 0.2, pinDiameter: 4, pinLength: 6, autoPins: true, pinsPerJoint: 1 };

const plan = planGrid(bbox, printer);
const expectedParts = partCount(plan.divisions);
console.log(
  'divisions', plan.divisions,
  'planes', plan.planes.length,
  'expected parts', expectedParts
);
if (expectedParts !== 8) {
  console.error(`SMOKE TEST FAILED: expected a 2x2x2 grid, got ${expectedParts} parts`);
  process.exit(1);
}

// Clean grid cut, mirroring splitByPlanes in the worker.
function cleanCut() {
  const root = new Manifold(new Mesh({ numProp: 3, ...boxMesh(S, S, S) }));
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
  return frags;
}

const plainFrags = cleanCut();
const plainVol = plainFrags.reduce((s, f) => s + f.volume(), 0);
for (const f of plainFrags) f.delete();

// Pins are added per final interface, exactly as the worker does it.
const pinned = addInterfacePins(Manifold, cleanCut(), plan.planes, connectors);
const frags = pinned.parts;
console.log(`interfaces=${pinned.interfaces} interfacesPinned=${pinned.interfacesPinned}`);

const nominalCell = (S / plan.divisions.x) * (S / plan.divisions.y) * (S / plan.divisions.z);
let totalVol = 0;
let allValid = true;
let maxVol = -Infinity;
let minVol = Infinity;
for (const [i, f] of frags.entries()) {
  const status = f.status();
  const vol = f.volume();
  const valid = status === 'NoError' && f.numTri() > 0 && vol > 0;
  if (!valid) allValid = false;
  totalVol += vol;
  maxVol = Math.max(maxVol, vol);
  minVol = Math.min(minVol, vol);
  console.log(`part ${i + 1}: status=${status} tris=${f.numTri()} vol=${vol.toFixed(0)}`);
}

// Reassemble in world space (parts never moved, so unioning re-forms the model).
// No material overlap => union volume == sum of part volumes. If a peg landed on
// the same side as its socket, parts would overlap and the union would shrink.
let reunion = frags[0];
let ownReunion = false;
for (let i = 1; i < frags.length; i++) {
  const merged = reunion.add(frags[i]);
  if (ownReunion) reunion.delete();
  reunion = merged;
  ownReunion = true;
}
const unionVol = reunion.volume();
const unionStatus = reunion.status();
if (ownReunion) reunion.delete();
for (const f of frags) f.delete();

const noConnCase = S * S * S; // 27,000,000
const pass = { pass: true };
const check = (label, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!cond) pass.pass = false;
};

check('parts count is 8', frags.length === 8, `${frags.length}`);
// A 2x2x2 grid has 12 internal face adjacencies (3 axes x 4 pairs each). Every
// interface lies inside the solid cube, so all 12 must be pinned. This is the
// direct signal that pins are placed per final interface, not hierarchically.
check('found all 12 grid interfaces', pinned.interfaces === 12, `${pinned.interfaces}`);
check('pinned every interface', pinned.interfacesPinned === 12, `${pinned.interfacesPinned}`);
check('auto sizes 150mm faces to 3 pins', autoPinCount(150, connectors.pinDiameter) === 3, `${autoPinCount(150, connectors.pinDiameter)}`);
check('plain cut conserves volume', Math.abs(plainVol - noConnCase) / noConnCase < 1e-6, plainVol.toFixed(0));
check('all parts watertight, non-empty', allValid);
check('total < no-connector volume (clearance removes net material)', totalVol < noConnCase, `${totalVol.toFixed(0)} < ${noConnCase}`);
check('total not wildly off (within 1%)', totalVol > noConnCase * 0.99, totalVol.toFixed(0));
check('at least one part gained volume (peg)', maxVol > nominalCell + 1, `max ${maxVol.toFixed(0)} vs cell ${nominalCell.toFixed(0)}`);
check('at least one part lost volume (socket)', minVol < nominalCell - 1, `min ${minVol.toFixed(0)} vs cell ${nominalCell.toFixed(0)}`);
check('reassembly is a valid manifold', unionStatus === 'NoError', unionStatus);
check('reassembly has no material overlap (peg seats in socket)', Math.abs(unionVol - totalVol) / noConnCase < 1e-4, `union ${unionVol.toFixed(0)} vs sum ${totalVol.toFixed(0)}`);

// Verify the other connector types produce valid, non-overlapping parts. Inserts
// and magnets only remove material (no protrusions), so parts stay disjoint and
// reassembly volume must equal the sum of parts exactly.
function verifyType(label, opts) {
  const res = addInterfacePins(Manifold, cleanCut(), plan.planes, opts);
  const parts = res.parts;
  const valid = parts.every((p) => p.status() === 'NoError' && p.numTri() > 0 && p.volume() > 0);
  const total = parts.reduce((s, p) => s + p.volume(), 0);
  let u = parts[0];
  let own = false;
  for (let i = 1; i < parts.length; i++) {
    const m = u.add(parts[i]);
    if (own) u.delete();
    u = m;
    own = true;
  }
  const uVol = u.volume();
  const uStatus = u.status();
  if (own) u.delete();
  for (const p of parts) p.delete();

  check(`${label}: found + engaged all 12 interfaces`, res.interfaces === 12 && res.interfacesPinned === 12, `${res.interfacesPinned}/${res.interfaces}`);
  check(`${label}: all parts watertight`, valid);
  check(`${label}: removes net material`, total < noConnCase && total > noConnCase * 0.98, total.toFixed(0));
  check(`${label}: reassembly valid, no overlap`, uStatus === 'NoError' && Math.abs(uVol - total) / noConnCase < 1e-4, `union ${uVol.toFixed(0)} vs sum ${total.toFixed(0)}`);
}

verifyType('insert', { type: 'insert', clearance: 0.2, insertDiameter: 4, insertDepth: 5, screwDiameter: 3.4, minWall: 1.5, autoPins: true, pinsPerJoint: 1 });
verifyType('magnet', { type: 'magnet', clearance: 0.2, magnetDiameter: 6, magnetThickness: 3, minWall: 1.5, autoPins: true, pinsPerJoint: 1 });
verifyType('dovetail', { type: 'dovetail', clearance: 0.3, dovetailWidth: 14, dovetailNeck: 8, dovetailDepth: 6, minWall: 1.5 });

if (!pass.pass) {
  console.error('SMOKE TEST FAILED');
  process.exit(1);
}
console.log('SMOKE TEST PASSED');
