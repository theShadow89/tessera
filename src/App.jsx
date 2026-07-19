import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { Scene } from './viewer/Scene.js';
import { loadModel } from './geometry/loaders.js';
import { geometryToManifoldInput, manifoldOutputToGeometry } from './geometry/meshBridge.js';
import { cutMesh, analyzeMesh } from './geometry/manifoldClient.js';
import { planGrid, partCount } from './core/partition.js';
import { manualToPlanes, planesToManual, estimatePartCount, fitReport } from './core/planes.js';
import { exportParts } from './geometry/exporter.js';
import Controls from './ui/Controls.jsx';
import AgentPanel from './agent/AgentPanel.jsx';

const PRESETS = {
  'Prusa MK4 (250×210×220)': { x: 250, y: 210, z: 220 },
  'Prusa MINI (180×180×180)': { x: 180, y: 180, z: 180 },
  'Bambu X1C / P1S (256×256×256)': { x: 256, y: 256, z: 256 },
  'Bambu A1 mini (180×180×180)': { x: 180, y: 180, z: 180 },
  'Anycubic Kobra S1 (250×250×250)': { x: 250, y: 250, z: 250 },
  'Creality K1 (220×220×250)': { x: 220, y: 220, z: 250 },
  'Ender 3 (220×220×250)': { x: 220, y: 220, z: 250 },
  'Custom': null,
};

export default function App() {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const geometryRef = useRef(null); // loaded source geometry (whole model)

  const [modelName, setModelName] = useState(null);
  const [size, setSize] = useState(null); // {x,y,z} mm
  const [printer, setPrinter] = useState({ x: 250, y: 210, z: 220 });
  const [presetKey, setPresetKey] = useState('Prusa MK4 (250×210×220)');
  const [plan, setPlan] = useState(null); // { divisions, planes, fits } from auto grid
  const [bounds, setBounds] = useState(null); // model bbox {min:{x,y,z}, max:{x,y,z}}
  const [planMode, setPlanMode] = useState('auto'); // 'auto' | 'manual'
  const [manualPlanes, setManualPlanes] = useState([]); // [{axis, offset}]
  // Connector options. Clearance is a user parameter (printer/material dependent),
  // never hardcoded in the geometry engine.
  const [connectors, setConnectors] = useState({
    type: 'pin',
    clearance: 0.2,
    // pin
    pinDiameter: 4,
    pinLength: 6,
    // heat-set insert + screw (M3 defaults)
    insertDiameter: 4,
    insertDepth: 5,
    screwDiameter: 3.4,
    // magnet
    magnetDiameter: 6,
    magnetThickness: 3,
    // dovetail (sliding joint)
    dovetailWidth: 14,
    dovetailNeck: 8,
    dovetailDepth: 6,
    // shared
    minWall: 1.5,
    autoPins: true,
    pinsPerJoint: 1,
  });
  const [repair, setRepair] = useState(true); // repair non-manifold input
  const [analysis, setAnalysis] = useState(null); // { manifold, status, report }
  const [explode, setExplode] = useState(0.2);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Load an STL, OBJ, or 3MF to start.');
  const [error, setError] = useState(null);
  const [hasParts, setHasParts] = useState(false);
  const [selected, setSelected] = useState([]); // per-part download selection
  const [proactiveSignal, setProactiveSignal] = useState(0); // bumps when a model loads
  const partsRef = useRef(null); // exported geometries

  // Live mirror of the agent-relevant state. The agent loop runs across awaits
  // without React re-rendering, so its tools read and write this ref to stay
  // consistent within a single run; React state is the UI mirror.
  const liveRef = useRef({});
  useEffect(() => {
    liveRef.current = { printer, connectors, planMode, manualPlanes, repair, bounds, size, analysis, plan };
  });

  useEffect(() => {
    const scene = new Scene(mountRef.current);
    sceneRef.current = scene;
    if (import.meta.env.DEV) window.__scene = scene; // dev-only debug handle
    return () => scene.dispose();
  }, []);

  const recomputePlan = useCallback((bboxSize, prn) => {
    if (!geometryRef.current) return;
    const box = geometryRef.current.boundingBox;
    const p = planGrid(box, prn);
    setPlan(p);
    return p;
  }, []);

  // Check whether the current model is a valid manifold (optionally after repair).
  const analyzeCurrent = useCallback(async (rep) => {
    if (!geometryRef.current) return;
    try {
      const input = geometryToManifoldInput(geometryRef.current);
      setAnalysis(await analyzeMesh(input, rep));
    } catch (err) {
      setAnalysis({ manifold: false, status: err.message, report: null });
    }
  }, []);

  const handleFile = useCallback(
    async (file) => {
      setError(null);
      setBusy(true);
      setStatus(`Loading ${file.name}…`);
      try {
        const geo = await loadModel(file);
        geo.computeBoundingBox();
        geo.computeVertexNormals();
        geometryRef.current = geo;
        setModelName(file.name);

        const box = geo.boundingBox;
        const sz = {
          x: box.max.x - box.min.x,
          y: box.max.y - box.min.y,
          z: box.max.z - box.min.z,
        };
        setSize(sz);
        setBounds({
          min: { x: box.min.x, y: box.min.y, z: box.min.z },
          max: { x: box.max.x, y: box.max.y, z: box.max.z },
        });
        // A new model resets manual edits back to the auto suggestion.
        setPlanMode('auto');
        setManualPlanes([]);
        const center = box.getCenter(new THREE.Vector3());

        // Show the whole model as a single "part" until split.
        sceneRef.current.setParts([geo.clone()], center);
        sceneRef.current.frameAll();
        setHasParts(false);
        partsRef.current = null;
        setAnalysis(null);
        analyzeCurrent(repair);
        setProactiveSignal((n) => n + 1);

        const p = recomputePlan(sz, printer);
        setStatus(
          p.fits
            ? 'Model already fits the printer. Split anyway if you want sections.'
            : `Needs ${partCount(p.divisions)} parts (${p.divisions.x}×${p.divisions.y}×${p.divisions.z}).`
        );
      } catch (err) {
        setError(err.message);
        setStatus('Load failed.');
      } finally {
        setBusy(false);
      }
    },
    [printer, recomputePlan, analyzeCurrent, repair]
  );

  const handleRepairChange = useCallback(
    (v) => {
      setRepair(v);
      analyzeCurrent(v);
    },
    [analyzeCurrent]
  );

  const handlePrinterChange = useCallback(
    (prn, key) => {
      setPrinter(prn);
      if (key) setPresetKey(key);
      if (size) {
        const p = recomputePlan(size, prn);
        if (p) {
          setStatus(
            p.fits
              ? 'Model fits the printer.'
              : `Needs ${partCount(p.divisions)} parts (${p.divisions.x}×${p.divisions.y}×${p.divisions.z}).`
          );
        }
      }
    },
    [size, recomputePlan]
  );

  // Planes actually used for cutting: the auto grid, or the manual edits.
  const activePlanes = useMemo(
    () => (planMode === 'manual' ? manualToPlanes(manualPlanes) : plan?.planes ?? []),
    [planMode, manualPlanes, plan]
  );

  // Whether the resulting parts fit the printer (manual planes can violate this).
  const fit = useMemo(
    () => (bounds ? fitReport(activePlanes, bounds, printer) : null),
    [activePlanes, bounds, printer]
  );

  // Preview the cut planes in 3D while the model is whole (hidden once split).
  // In manual mode they carry their index and become draggable via the gizmo.
  useEffect(() => {
    if (!sceneRef.current) return;
    if (bounds && !hasParts) {
      const editable = planMode === 'manual';
      const indexed = activePlanes.map((p, i) => ({ ...p, index: i }));
      sceneRef.current.setCutPlanes(indexed, bounds, editable);
    } else {
      sceneRef.current.setCutPlanes(null, null);
    }
  }, [activePlanes, bounds, hasParts, planMode]);

  const handlePlanMode = useCallback(
    (mode) => {
      setPlanMode(mode);
      // Entering manual mode: seed from the current auto grid so the user tweaks
      // a sensible starting point rather than an empty set.
      if (mode === 'manual' && manualPlanes.length === 0 && plan) {
        setManualPlanes(planesToManual(plan.planes));
      }
    },
    [manualPlanes.length, plan]
  );

  const clampToBounds = useCallback(
    (axis, offset) => {
      if (!bounds) return offset;
      const lo = bounds.min[axis];
      const hi = bounds.max[axis];
      return Math.min(hi, Math.max(lo, offset));
    },
    [bounds]
  );

  const addManualPlane = useCallback(
    (axis) => {
      if (!bounds) return;
      const mid = (bounds.min[axis] + bounds.max[axis]) / 2;
      setManualPlanes((prev) => [...prev, { axis, offset: Math.round(mid * 10) / 10 }]);
    },
    [bounds]
  );

  const editManualPlane = useCallback(
    (index, offset) => {
      setManualPlanes((prev) =>
        prev.map((p, i) => (i === index ? { ...p, offset: clampToBounds(p.axis, offset) } : p))
      );
    },
    [clampToBounds]
  );

  const removeManualPlane = useCallback((index) => {
    setManualPlanes((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Core cut: runs the worker, renders the exploded parts, returns the
  // geometries. Takes its inputs as arguments so both the UI and the agent can
  // drive it without depending on React's async state timing.
  const performSplit = useCallback(
    async (planes, connectorOpts, repairOpt, optimizeOpt = null) => {
      const input = geometryToManifoldInput(geometryRef.current);
      const parts = await cutMesh(input, planes, connectorOpts, repairOpt, optimizeOpt);
      const geometries = parts.map(manifoldOutputToGeometry);
      partsRef.current = geometries;

      const center = geometryRef.current.boundingBox.getCenter(new THREE.Vector3());
      sceneRef.current.setParts(
        geometries.map((g) => g.clone()),
        center
      );
      sceneRef.current.setExplode(explode);
      setHasParts(true);
      setSelected(geometries.map(() => true));
      return geometries;
    },
    [explode]
  );

  const handleSplit = useCallback(async () => {
    if (!geometryRef.current || activePlanes.length === 0) return;
    setError(null);
    setBusy(true);
    setStatus(planMode === 'auto' ? 'Optimizing cuts…' : 'Cutting…');
    try {
      const optimize = planMode === 'auto' ? { printer } : null;
      const geometries = await performSplit(activePlanes, connectors, repair, optimize);
      setStatus(`Done: ${geometries.length} parts.`);
    } catch (err) {
      setError(err.message);
      setStatus('Cut failed.');
    } finally {
      setBusy(false);
    }
  }, [activePlanes, connectors, repair, performSplit, planMode, printer]);

  const handleExplode = useCallback((v) => {
    setExplode(v);
    sceneRef.current?.setExplode(v);
  }, []);

  const handleTogglePart = useCallback((index) => {
    setSelected((prev) => prev.map((v, i) => (i === index ? !v : v)));
  }, []);

  const handleSelectAll = useCallback((value) => {
    setSelected((prev) => prev.map(() => value));
  }, []);

  const handleExport = useCallback(() => {
    if (!partsRef.current) return;
    const indices = selected.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    if (indices.length === 0) return;
    const base = (modelName || 'tessera').replace(/\.[^.]+$/, '');
    exportParts(partsRef.current, indices, base);
  }, [modelName, selected]);

  // Tool executor for the AI agent. Reads/writes liveRef so a multi-step agent
  // run stays consistent, and mirrors every change into React state for the UI.
  const executeTool = useCallback(
    async (name, input) => {
      const s = liveRef.current;
      const activeOf = () =>
        s.planMode === 'manual' ? manualToPlanes(s.manualPlanes || []) : s.plan?.planes ?? [];

      switch (name) {
        case 'get_state': {
          if (!geometryRef.current) return { loaded: false };
          const active = activeOf();
          const fit = s.bounds ? fitReport(active, s.bounds, s.printer) : null;
          return {
            loaded: true,
            sizeMm: s.size,
            printer: s.printer,
            planMode: s.planMode,
            manualPlanes: s.manualPlanes,
            connector: s.connectors,
            repair: s.repair,
            partsEstimate: estimatePartCount(active, s.bounds),
            fitsPrinter: fit ? fit.fits : null,
            meshManifold: s.analysis ? s.analysis.manifold : null,
          };
        }
        case 'set_printer': {
          const p = { x: Number(input.x), y: Number(input.y), z: Number(input.z) };
          handlePrinterChange(p, 'Custom');
          s.printer = p;
          if (geometryRef.current) s.plan = planGrid(geometryRef.current.boundingBox, p);
          return { ok: true, printer: p };
        }
        case 'use_auto_grid': {
          handlePlanMode('auto');
          s.planMode = 'auto';
          return { ok: true };
        }
        case 'set_manual_planes': {
          const planes = (input.planes || []).map((pl) => ({
            axis: pl.axis,
            offset: clampToBounds(pl.axis, Number(pl.offset)),
          }));
          setPlanMode('manual');
          setManualPlanes(planes);
          s.planMode = 'manual';
          s.manualPlanes = planes;
          return { ok: true, planes };
        }
        case 'set_connector': {
          const next = { ...s.connectors, ...input };
          setConnectors(next);
          s.connectors = next;
          return { ok: true, connector: next };
        }
        case 'set_repair': {
          const enabled = !!input.enabled;
          handleRepairChange(enabled);
          s.repair = enabled;
          return { ok: true, repair: enabled };
        }
        case 'split': {
          if (!geometryRef.current) return { error: 'No model loaded.' };
          const active = activeOf();
          if (active.length === 0) return { error: 'No cuts planned; the model would stay whole.' };
          setError(null);
          setBusy(true);
          setStatus('Cutting…');
          try {
            const optimize = s.planMode === 'auto' ? { printer: s.printer } : null;
            const geos = await performSplit(active, s.connectors, s.repair, optimize);
            const fit = s.bounds ? fitReport(active, s.bounds, s.printer) : null;
            setStatus(`Done: ${geos.length} parts.`);
            return { parts: geos.length, fitsPrinter: fit ? fit.fits : null };
          } catch (err) {
            setError(err.message);
            setStatus('Cut failed.');
            return { error: err.message };
          } finally {
            setBusy(false);
          }
        }
        case 'propose_plan':
          // Proactive mode: record nothing, change nothing. The panel captures
          // the proposal from the tool input and shows Apply / Dismiss.
          return { ok: true, note: 'Proposal shown to the user for approval.' };
        default:
          return { error: `Unknown tool: ${name}` };
      }
    },
    [handlePrinterChange, handlePlanMode, clampToBounds, handleRepairChange, performSplit]
  );

  // Apply an approved proactive proposal: set the fields it names, then split.
  const applyProposal = useCallback(
    async (p) => {
      if (p.printer) await executeTool('set_printer', p.printer);
      if (p.planMode === 'manual') await executeTool('set_manual_planes', { planes: p.planes || [] });
      else await executeTool('use_auto_grid', {});
      if (p.connectorType) await executeTool('set_connector', { type: p.connectorType });
      return executeTool('split', {});
    },
    [executeTool]
  );

  // Route gizmo drags (index, offset) into the manual-plane editor (which clamps).
  useEffect(() => {
    sceneRef.current?.setPlaneChangeHandler(editManualPlane);
  }, [editManualPlane]);

  // Dev-only handles to drive the agent tools / proposal apply without a live
  // model (for testing).
  useEffect(() => {
    if (import.meta.env.DEV) {
      window.__executeTool = executeTool;
      window.__applyProposal = applyProposal;
    }
  }, [executeTool, applyProposal]);

  return (
    <div className="app">
      <div className="viewport" ref={mountRef}>
        <AgentPanel
          executeTool={executeTool}
          applyProposal={applyProposal}
          proactiveSignal={proactiveSignal}
        />
      </div>
      <Controls
        presets={PRESETS}
        presetKey={presetKey}
        printer={printer}
        size={size}
        repair={repair}
        analysis={analysis}
        plan={plan}
        bounds={bounds}
        planMode={planMode}
        manualPlanes={manualPlanes}
        partsEstimate={estimatePartCount(activePlanes, bounds)}
        fit={fit}
        connectors={connectors}
        modelName={modelName}
        busy={busy}
        status={status}
        error={error}
        explode={explode}
        hasParts={hasParts}
        selected={selected}
        onFile={handleFile}
        onRepairChange={handleRepairChange}
        onPrinterChange={handlePrinterChange}
        onPlanMode={handlePlanMode}
        onAddManualPlane={addManualPlane}
        onEditManualPlane={editManualPlane}
        onRemoveManualPlane={removeManualPlane}
        onConnectorsChange={setConnectors}
        onSplit={handleSplit}
        onExplode={handleExplode}
        onTogglePart={handleTogglePart}
        onSelectAll={handleSelectAll}
        onExport={handleExport}
      />
    </div>
  );
}
