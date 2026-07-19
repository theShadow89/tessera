import React, { useState, useRef, useEffect } from 'react';
import { runAgent } from './agentClient.js';
import { TOOLS, SYSTEM_PROMPT, PROACTIVE_TOOLS, PROACTIVE_SYSTEM, PROACTIVE_TRIGGER } from './tools.js';
import { PROVIDERS, PROVIDER_PRESETS } from './providers.js';
import { platformFetch } from './platformFetch.js';

const CFG_STORAGE = 'tessera_agent_cfg';

function loadCfg() {
  try {
    const saved = JSON.parse(localStorage.getItem(CFG_STORAGE) || '{}');
    return { presetId: 'claude', model: '', baseURL: '', apiKey: '', proactive: false, ...saved };
  } catch {
    return { presetId: 'claude', model: '', baseURL: '', apiKey: '', proactive: false };
  }
}

/** Human-readable reason a health check failed. */
function describeHealth(res, url) {
  if (res.code === 'auth') return 'The server rejected the key. Check your API key.';
  if (res.code === 'http') return `Server responded with HTTP ${res.status}.`;
  // unreachable
  const local = /localhost|127\.0\.0\.1/.test(url || '');
  return local
    ? `Can't reach ${url}. Is the server running, and does it allow this page (CORS)?`
    : `Can't reach ${url}. Network or CORS issue — the desktop app avoids this.`;
}

/**
 * Floating AI assistant. Works with Claude or any OpenAI-compatible endpoint
 * (Ollama, LM Studio, OpenAI). Config/key live in the browser only. Drives the
 * app through executeTool. In proactive mode it auto-suggests a plan when a
 * model loads, but only applies it after the user clicks Apply.
 *
 * @param {{
 *   executeTool: (name:string, input:object)=>Promise<object>,
 *   applyProposal: (proposal:object)=>Promise<object>,
 *   proactiveSignal: number,
 * }} props
 */
export default function AgentPanel({ executeTool, applyProposal, proactiveSignal }) {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState(loadCfg);
  const [showCfg, setShowCfg] = useState(false);
  const [input, setInput] = useState('');
  const [log, setLog] = useState([]); // { kind, text } | { kind:'proposal', proposal, applied }
  const [busy, setBusy] = useState(false);
  // Live reachability of the configured endpoint.
  const [health, setHealth] = useState({ state: 'unknown', message: '' });
  const [retry, setRetry] = useState(0);
  const messagesRef = useRef([]); // normalized chat conversation
  const logEndRef = useRef(null);
  const lastSignalRef = useRef(0);
  const checkIdRef = useRef(0);

  const preset = PROVIDER_PRESETS.find((p) => p.id === cfg.presetId) || PROVIDER_PRESETS[0];
  const needsKey = preset.key === 'required';
  const hasKey = !needsKey || !!cfg.apiKey.trim();
  const hasModel = !!(cfg.model.trim() || preset.model);
  // The model service is usable only with a model set, (for hosted providers) a
  // key, AND the endpoint actually responding. Until then, sending is blocked.
  const configured = hasKey && hasModel;
  const canSend = configured && health.state === 'ok';

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'end' });
  }, [log]);

  const updateCfg = (patch) => {
    setCfg((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(CFG_STORAGE, JSON.stringify(next));
      return next;
    });
  };

  const providerOpts = () => ({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseURL || preset.baseURL,
    model: cfg.model || preset.model,
    fetchImpl: platformFetch,
  });

  // Probe the endpoint whenever the config changes (debounced) or on Retry.
  // Until it answers OK, chat is disabled. Stale results are dropped by id.
  useEffect(() => {
    if (!configured) {
      setHealth({ state: 'unknown', message: '' });
      return;
    }
    const id = ++checkIdRef.current;
    setHealth({ state: 'checking', message: '' });
    const timer = setTimeout(async () => {
      const res = await PROVIDERS[preset.provider].health(providerOpts());
      if (checkIdRef.current !== id) return; // config changed mid-check
      if (res.ok) setHealth({ state: 'ok', message: '' });
      else setHealth({ state: 'error', message: describeHealth(res, cfg.baseURL || preset.baseURL) });
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.presetId, cfg.model, cfg.baseURL, cfg.apiKey, configured, retry]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy || !canSend) return;
    setInput('');
    setLog((l) => [...l, { kind: 'user', text }]);
    setBusy(true);
    messagesRef.current.push({ role: 'user', text });

    try {
      const { messages } = await runAgent({
        provider: PROVIDERS[preset.provider],
        providerOpts: providerOpts(),
        messages: messagesRef.current,
        executeTool,
        tools: TOOLS,
        system: SYSTEM_PROMPT,
        onEvent: (ev) => {
          if (ev.type === 'text' && ev.text) setLog((l) => [...l, { kind: 'assistant', text: ev.text }]);
          else if (ev.type === 'tool') setLog((l) => [...l, { kind: 'tool', text: ev.name }]);
        },
      });
      messagesRef.current = messages;
    } catch (err) {
      setLog((l) => [...l, { kind: 'error', text: err.message || String(err) }]);
    } finally {
      setBusy(false);
    }
  };

  // Proactive run: on a fresh model load, suggest a plan (read-only + propose).
  // Debounced so several quick loads (or a burst of signals) coalesce into one
  // run, and it never fires while a run is in flight.
  useEffect(() => {
    if (!cfg.proactive || proactiveSignal === 0 || proactiveSignal === lastSignalRef.current) return;
    if (!canSend || busy) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      lastSignalRef.current = proactiveSignal;
      setBusy(true);
      runAgent({
        provider: PROVIDERS[preset.provider],
        providerOpts: providerOpts(),
        messages: [{ role: 'user', text: PROACTIVE_TRIGGER }],
        executeTool,
        tools: PROACTIVE_TOOLS,
        system: PROACTIVE_SYSTEM,
        onEvent: (ev) => {
          if (cancelled) return;
          if (ev.type === 'tool' && ev.name === 'propose_plan') {
            setLog((l) => [...l, { kind: 'proposal', proposal: ev.input, applied: false }]);
          } else if (ev.type === 'text' && ev.text) {
            setLog((l) => [...l, { kind: 'assistant', text: ev.text }]);
          }
        },
      })
        .catch((err) => {
          if (!cancelled) setLog((l) => [...l, { kind: 'error', text: err.message || String(err) }]);
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    }, 900);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [proactiveSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyAt = async (index) => {
    const entry = log[index];
    if (!entry || entry.applied || busy) return;
    setBusy(true);
    setLog((l) => l.map((m, i) => (i === index ? { ...m, applied: true } : m)));
    try {
      const res = await applyProposal(entry.proposal);
      setLog((l) => [...l, { kind: 'assistant', text: `Applied: ${res?.parts ?? '?'} parts.` }]);
    } catch (err) {
      setLog((l) => [...l, { kind: 'error', text: err.message || String(err) }]);
    } finally {
      setBusy(false);
    }
  };

  const dismissAt = (index) => {
    setLog((l) => l.map((m, i) => (i === index ? { ...m, applied: true, dismissed: true } : m)));
  };

  if (!open) {
    return (
      <button
        className={`agent-fab ${cfg.proactive ? 'active' : ''}`}
        onClick={() => setOpen(true)}
        title="AI assistant"
      >
        AI
      </button>
    );
  }

  const summarize = (p) => {
    const parts = [];
    if (p.printer) parts.push(`printer ${p.printer.x}×${p.printer.y}×${p.printer.z}`);
    parts.push(p.planMode === 'manual' ? `${(p.planes || []).length} manual cut(s)` : 'auto grid');
    if (p.connectorType) parts.push(p.connectorType);
    return parts.join(', ');
  };

  return (
    <div className="agent-panel">
      <div className="agent-head">
        <span>AI assistant</span>
        <div>
          <button className="agent-close" onClick={() => setShowCfg((v) => !v)} title="Settings">
            ⚙
          </button>
          <button className="agent-close" onClick={() => setOpen(false)}>
            ×
          </button>
        </div>
      </div>

      {(showCfg || !configured) && (
        <div className="agent-key">
          <select
            value={cfg.presetId}
            onChange={(e) => updateCfg({ presetId: e.target.value, model: '', baseURL: '' })}
          >
            {PROVIDER_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder={`Model (default: ${preset.model || 'none'})`}
            value={cfg.model}
            onChange={(e) => updateCfg({ model: e.target.value })}
          />
          {preset.provider === 'openai' && (
            <input
              type="text"
              placeholder={`Base URL (default: ${preset.baseURL || 'none'})`}
              value={cfg.baseURL}
              onChange={(e) => updateCfg({ baseURL: e.target.value })}
            />
          )}
          {preset.key !== 'none' && (
            <input
              type="password"
              placeholder={needsKey ? 'API key (required)' : 'API key (optional)'}
              value={cfg.apiKey}
              onChange={(e) => updateCfg({ apiKey: e.target.value })}
            />
          )}
          <label className="agent-toggle">
            <input
              type="checkbox"
              checked={cfg.proactive}
              onChange={(e) => updateCfg({ proactive: e.target.checked })}
            />
            Proactive: suggest a plan when a model loads
          </label>
          <div className="hint">
            Config and key are stored in your browser only and sent directly to the endpoint above.
          </div>
        </div>
      )}

      <div className="agent-log">
        {log.length === 0 && (
          <div className="hint">
            Ask me to set up a split, e.g. “make this printable on an Ender 3 with magnets” or “cut
            it in half along X”.
          </div>
        )}
        {log.map((m, i) =>
          m.kind === 'proposal' ? (
            <div key={i} className="agent-msg assistant proposal">
              <div>{m.proposal.rationale}</div>
              <div className="proposal-summary">{summarize(m.proposal)}</div>
              {!m.applied && (
                <div className="proposal-actions">
                  <button onClick={() => applyAt(i)} disabled={busy}>
                    Apply
                  </button>
                  <button className="ghost" onClick={() => dismissAt(i)}>
                    Dismiss
                  </button>
                </div>
              )}
              {m.applied && <div className="hint">{m.dismissed ? 'Dismissed' : 'Applied'}</div>}
            </div>
          ) : (
            <div key={i} className={`agent-msg ${m.kind}`}>
              {m.kind === 'tool' ? <code>▸ {m.text}</code> : m.text}
            </div>
          )
        )}
        {busy && <div className="agent-msg tool">working…</div>}
        <div ref={logEndRef} />
      </div>

      {!configured && (
        <div className="agent-notice">
          Configure a model provider in settings (⚙) to start
          {needsKey && !hasKey ? ' — add an API key' : ''}
          {!hasModel ? `${needsKey && !hasKey ? ' and' : ' —'} set a model` : ''}.
        </div>
      )}
      {configured && health.state === 'checking' && (
        <div className="agent-status checking">Checking connection…</div>
      )}
      {configured && health.state === 'ok' && (
        <div className="agent-status ok">● Connected</div>
      )}
      {configured && health.state === 'error' && (
        <div className="agent-notice">
          {health.message}{' '}
          <button className="linkish" onClick={() => setRetry((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}

      <div className="agent-input">
        <input
          value={input}
          placeholder={canSend ? 'Describe what you want…' : 'Connect a provider first…'}
          disabled={busy || !canSend}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSend) send();
          }}
        />
        <button onClick={send} disabled={busy || !input.trim() || !canSend}>
          Send
        </button>
      </div>
    </div>
  );
}
