import React, { useRef } from 'react';

const AXES = ['x', 'y', 'z'];

// Numeric fields shown per connector type. Shared fields (min wall, per-joint
// count, auto) are rendered separately below these.
const TYPE_FIELDS = {
  pin: [
    { key: 'clearance', label: 'Clearance', step: 0.05 },
    { key: 'pinDiameter', label: 'Diameter', step: 0.5 },
    { key: 'pinLength', label: 'Length', step: 0.5 },
  ],
  insert: [
    { key: 'insertDiameter', label: 'Insert Ø', step: 0.1 },
    { key: 'insertDepth', label: 'Insert depth', step: 0.5 },
    { key: 'screwDiameter', label: 'Screw Ø', step: 0.1 },
  ],
  magnet: [
    { key: 'clearance', label: 'Clearance', step: 0.05 },
    { key: 'magnetDiameter', label: 'Magnet Ø', step: 0.5 },
    { key: 'magnetThickness', label: 'Magnet thick.', step: 0.5 },
  ],
  dovetail: [
    { key: 'clearance', label: 'Clearance', step: 0.05 },
    { key: 'dovetailWidth', label: 'Wide', step: 0.5 },
    { key: 'dovetailNeck', label: 'Neck', step: 0.5 },
    { key: 'dovetailDepth', label: 'Depth', step: 0.5 },
  ],
};

/** Chunk a list into rows of two for the two-column field layout. */
function rowsOf(items) {
  const rows = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return rows;
}

/** Human summary of what repair changed. */
function describeRepair(report) {
  const parts = [];
  if (report.holesFilled) parts.push(`filled ${report.holesFilled} hole${report.holesFilled > 1 ? 's' : ''}`);
  if (report.degenerateRemoved)
    parts.push(`removed ${report.degenerateRemoved} bad triangle${report.degenerateRemoved > 1 ? 's' : ''}`);
  return parts.length ? parts.join(', ') + '.' : 'cleaned up.';
}

/** Reason a mesh could not be made manifold, if known. */
function describeUnrepairable(report) {
  if (report && report.nonManifoldEdges)
    return ` (${report.nonManifoldEdges} non-manifold edges, likely self-intersections)`;
  return '';
}

export default function Controls({
  presets,
  presetKey,
  printer,
  size,
  repair,
  analysis,
  plan,
  bounds,
  planMode,
  manualPlanes,
  partsEstimate,
  fit,
  connectors,
  modelName,
  busy,
  status,
  error,
  explode,
  hasParts,
  selected,
  onFile,
  onRepairChange,
  onPrinterChange,
  onPlanMode,
  onAddManualPlane,
  onEditManualPlane,
  onRemoveManualPlane,
  onConnectorsChange,
  onSplit,
  onExplode,
  onTogglePart,
  onSelectAll,
  onExport,
}) {
  const fileInput = useRef(null);

  const pickPreset = (key) => {
    const dims = presets[key];
    if (dims) onPrinterChange({ ...dims }, key);
    else onPrinterChange({ ...printer }, key); // Custom: keep current, let user edit
  };

  const editAxis = (axis, value) => {
    const v = Math.max(1, Number(value) || 0);
    onPrinterChange({ ...printer, [axis]: v }, 'Custom');
  };

  const fmt = (n) => (n == null ? '—' : n.toFixed(1));

  const editConnector = (key, value) => {
    // Non-negative numbers; clearance may legitimately be 0, so no min of 1.
    const v = Math.max(0, Number(value) || 0);
    onConnectorsChange({ ...connectors, [key]: v });
  };

  const pinsDisabled = connectors.type === 'none';

  return (
    <aside className="panel">
      <h1>Tessera</h1>
      <p className="tagline">Split models to fit your printer, joined with connectors.</p>

      <section>
        <button
          className="primary"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
        >
          {modelName ? 'Load another model' : 'Load model'}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".stl,.obj,.3mf"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = '';
          }}
        />
        {modelName && <div className="filename">{modelName}</div>}
      </section>

      {size && (
        <section>
          <h2>Model size (mm)</h2>
          <div className="dims">
            {AXES.map((a) => (
              <span key={a}>
                {a.toUpperCase()} {fmt(size[a])}
              </span>
            ))}
          </div>
        </section>
      )}

      {modelName && (
        <section>
          <h2>Mesh</h2>
          {analysis === null ? (
            <div className="hint">Checking…</div>
          ) : analysis.manifold ? (
            <div className="mesh-ok">
              {analysis.report && analysis.report.changed
                ? `Repaired: ${describeRepair(analysis.report)}`
                : 'Valid manifold, ready to cut.'}
            </div>
          ) : (
            <div className="warn">
              Not a printable solid{describeUnrepairable(analysis.report)}. Cutting may fail.
            </div>
          )}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={repair}
              onChange={(e) => onRepairChange(e.target.checked)}
            />
            Repair mesh (weld, fill holes)
          </label>
        </section>
      )}

      <section>
        <h2>Printer volume</h2>
        <select value={presetKey} onChange={(e) => pickPreset(e.target.value)}>
          {Object.keys(presets).map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <div className="dims editable">
          {AXES.map((a) => (
            <label key={a}>
              {a.toUpperCase()}
              <input
                type="number"
                min="1"
                value={printer[a]}
                onChange={(e) => editAxis(a, e.target.value)}
              />
            </label>
          ))}
        </div>
      </section>

      {plan && (
        <section>
          <h2>Cut planes</h2>
          <div className="segmented">
            <button
              className={planMode === 'auto' ? 'active' : ''}
              onClick={() => onPlanMode('auto')}
            >
              Auto grid
            </button>
            <button
              className={planMode === 'manual' ? 'active' : ''}
              onClick={() => onPlanMode('manual')}
            >
              Manual
            </button>
          </div>

          {planMode === 'auto' && (
            <div className="plan">
              <div>
                Grid: <b>{plan.divisions.x}×{plan.divisions.y}×{plan.divisions.z}</b>
              </div>
              <div>
                Parts: <b>{partsEstimate}</b>
              </div>
              <div>Cut planes: {plan.planes.length}</div>
            </div>
          )}

          {planMode === 'manual' && (
            <>
              <div className="add-plane">
                <span>Add plane on</span>
                {AXES.map((a) => (
                  <button key={a} onClick={() => onAddManualPlane(a)} disabled={!bounds}>
                    {a.toUpperCase()}
                  </button>
                ))}
              </div>
              {manualPlanes.length === 0 ? (
                <div className="hint">No planes: the model stays whole. Add one above.</div>
              ) : (
                <div className="hint">Drag a plane in the 3D view, or edit its position below.</div>
              )}
              {manualPlanes.map((p, i) => (
                <div className="plane-row" key={i}>
                  <span className="axis-tag">{p.axis.toUpperCase()}</span>
                  <input
                    type="number"
                    step="1"
                    min={bounds ? fmt(bounds.min[p.axis]) : undefined}
                    max={bounds ? fmt(bounds.max[p.axis]) : undefined}
                    value={p.offset}
                    onChange={(e) => onEditManualPlane(i, Number(e.target.value))}
                  />
                  <span className="unit">mm</span>
                  <button className="remove" onClick={() => onRemoveManualPlane(i)}>
                    ×
                  </button>
                </div>
              ))}
              <div className="plan">
                <div>
                  Parts: <b>{partsEstimate}</b>
                </div>
              </div>
            </>
          )}

          {fit && !fit.fits && (
            <div className="warn">
              Some parts exceed the printer:
              {AXES.filter((a) => fit.over[a]).map((a) => (
                <span key={a}>
                  {' '}
                  {a.toUpperCase()} {fit.maxCell[a].toFixed(0)}/{fit.usable[a].toFixed(0)}mm
                </span>
              ))}
              . Add more planes on those axes.
            </div>
          )}
          <button className="primary" onClick={onSplit} disabled={busy || !size || partsEstimate < 2}>
            {busy ? 'Working…' : 'Split'}
          </button>
        </section>
      )}

      {plan && (
        <section>
          <h2>Connectors</h2>
          <select
            value={connectors.type}
            onChange={(e) => onConnectorsChange({ ...connectors, type: e.target.value })}
          >
            <option value="none">None</option>
            <option value="pin">Alignment pin</option>
            <option value="insert">Heat-set insert + screw</option>
            <option value="magnet">Magnet</option>
            <option value="dovetail">Dovetail (slide-in)</option>
          </select>

          {rowsOf(TYPE_FIELDS[connectors.type] || []).map((row, ri) => (
            <div className="dims editable" key={ri}>
              {row.map((f) => (
                <label key={f.key}>
                  {f.label}
                  <input
                    type="number"
                    min={f.min ?? 0}
                    step={f.step}
                    value={connectors[f.key]}
                    disabled={pinsDisabled}
                    onChange={(e) => editConnector(f.key, e.target.value)}
                  />
                </label>
              ))}
            </div>
          ))}

          {!pinsDisabled && (
            <>
              <div className="dims editable">
                <label>
                  Min wall
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={connectors.minWall}
                    onChange={(e) => editConnector('minWall', e.target.value)}
                  />
                </label>
                <label>
                  Per joint
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={connectors.pinsPerJoint}
                    disabled={connectors.autoPins}
                    onChange={(e) => editConnector('pinsPerJoint', e.target.value)}
                  />
                </label>
              </div>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={connectors.autoPins}
                  onChange={(e) => onConnectorsChange({ ...connectors, autoPins: e.target.checked })}
                />
                Auto count per joint (by interface size)
              </label>
            </>
          )}
        </section>
      )}

      {hasParts && (
        <section>
          <h2>Preview</h2>
          <label className="slider">
            Explode
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={explode}
              onChange={(e) => onExplode(Number(e.target.value))}
            />
          </label>

          <div className="parts-head">
            <span>Download parts</span>
            <span>
              <button className="linkish" onClick={() => onSelectAll(true)}>
                all
              </button>
              {' / '}
              <button className="linkish" onClick={() => onSelectAll(false)}>
                none
              </button>
            </span>
          </div>
          <div className="parts-list">
            {selected.map((on, i) => (
              <label key={i} className="checkbox">
                <input type="checkbox" checked={on} onChange={() => onTogglePart(i)} />
                Part {String(i + 1).padStart(2, '0')}
              </label>
            ))}
          </div>
          {(() => {
            const n = selected.filter(Boolean).length;
            return (
              <button className="primary" onClick={onExport} disabled={busy || n === 0}>
                {n <= 1 ? `Download ${n} part (STL)` : `Download ${n} parts (.zip)`}
              </button>
            );
          })()}
        </section>
      )}

      <footer>
        <div className={`status ${error ? 'error' : ''}`}>{error || status}</div>
      </footer>
    </aside>
  );
}
