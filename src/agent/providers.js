// LLM provider abstraction. The agent loop works on a normalized conversation;
// each provider translates it to/from its wire format so the same loop and the
// same tool schemas work with Anthropic (Claude) and any OpenAI-compatible
// endpoint (Ollama, LM Studio, vLLM, OpenRouter, OpenAI).
//
// Normalized message shapes:
//   { role: 'user', text }
//   { role: 'assistant', text, toolCalls: [{ id, name, input }] }
//   { role: 'tool', results: [{ id, name, content }] }   // content is a JSON string
//
// provider.chat(opts) resolves to { text, toolCalls: [{id,name,input}], stopReason }
// where stopReason is 'tool_use' when the model wants tools, else 'end_turn'.

const DEFAULT_MAX_TOKENS = 2048;

async function postJSON(url, headers, body, fetchImpl) {
  let res;
  try {
    res = await (fetchImpl || fetch)(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  } catch {
    // The browser can't tell "not running" from "blocked by CORS" — both are a
    // TypeError. Give an actionable message covering the common local case.
    const isLocal = /localhost|127\.0\.0\.1/.test(url);
    throw new Error(
      `Could not reach ${url}. Check the server is running` +
        (isLocal
          ? ', and that it allows this page. Ollama in a browser needs OLLAMA_ORIGINS set (e.g. `OLLAMA_ORIGINS=* ollama serve`); the desktop app avoids this.'
          : '.')
    );
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      detail = err?.error?.message || err?.error || detail;
    } catch {
      // status-only
    }
    throw new Error(detail);
  }
  return res.json();
}

/**
 * Lightweight GET to check a server is reachable and the key (if any) is
 * accepted. Returns { ok } on 2xx, or { ok:false, code } where code is
 * 'unreachable' (network/CORS/down), 'auth' (401/403), or 'http' (other status).
 */
async function ping(url, headers, fetchImpl) {
  let res;
  try {
    res = await (fetchImpl || fetch)(url, { method: 'GET', headers });
  } catch {
    return { ok: false, code: 'unreachable' };
  }
  if (res.ok) return { ok: true };
  if (res.status === 401 || res.status === 403) return { ok: false, code: 'auth', status: res.status };
  return { ok: false, code: 'http', status: res.status };
}

// ---------- Anthropic (Claude) ----------

function anthropicMessages(messages) {
  return messages.map((m) => {
    if (m.role === 'user') return { role: 'user', content: m.text };
    if (m.role === 'assistant') {
      const content = [];
      if (m.text) content.push({ type: 'text', text: m.text });
      for (const tc of m.toolCalls || []) {
        content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
      }
      return { role: 'assistant', content };
    }
    // tool results
    return {
      role: 'user',
      content: m.results.map((r) => ({
        type: 'tool_result',
        tool_use_id: r.id,
        content: r.content,
      })),
    };
  });
}

export const anthropicProvider = {
  name: 'anthropic',
  async chat({ apiKey, baseURL, model, system, tools, messages, maxTokens, fetchImpl }) {
    const url = (baseURL || 'https://api.anthropic.com/v1') + '/messages';
    const body = {
      model,
      max_tokens: maxTokens || DEFAULT_MAX_TOKENS,
      system,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      })),
      messages: anthropicMessages(messages),
    };
    const json = await postJSON(
      url,
      {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body,
      fetchImpl
    );
    const content = json.content || [];
    const text = content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    const toolCalls = content
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, input: b.input }));
    return { text, toolCalls, stopReason: json.stop_reason === 'tool_use' ? 'tool_use' : 'end_turn' };
  },
  async health({ apiKey, baseURL, fetchImpl }) {
    return ping(
      (baseURL || 'https://api.anthropic.com/v1') + '/models',
      { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      fetchImpl
    );
  },
};

// ---------- OpenAI-compatible (Ollama, LM Studio, vLLM, OpenRouter, OpenAI) ----------

function openaiMessages(system, messages) {
  const out = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.text });
    } else if (m.role === 'assistant') {
      const msg = { role: 'assistant', content: m.text || '' };
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.input) },
        }));
      }
      out.push(msg);
    } else {
      // one tool message per result
      for (const r of m.results) {
        out.push({ role: 'tool', tool_call_id: r.id, content: r.content });
      }
    }
  }
  return out;
}

export const openaiProvider = {
  name: 'openai',
  async chat({ apiKey, baseURL, model, system, tools, messages, maxTokens, fetchImpl }) {
    const base = (baseURL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const headers = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const body = {
      model,
      messages: openaiMessages(system, messages),
      tools: tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      })),
      tool_choice: 'auto',
      max_tokens: maxTokens || DEFAULT_MAX_TOKENS,
      stream: false,
    };
    const json = await postJSON(base + '/chat/completions', headers, body, fetchImpl);
    const choice = json.choices?.[0];
    const msg = choice?.message || {};
    const text = (msg.content || '').trim();
    const toolCalls = (msg.tool_calls || []).map((tc, i) => {
      // OpenAI sends arguments as a JSON string; some Ollama versions send an
      // object. Handle both. Also synthesize an id if the server omits one, so
      // the tool-result round-trip still links up.
      const raw = tc.function?.arguments;
      let input = {};
      if (raw && typeof raw === 'object') input = raw;
      else if (typeof raw === 'string' && raw.trim()) {
        try {
          input = JSON.parse(raw);
        } catch {
          input = {};
        }
      }
      return { id: tc.id || `call_${i}`, name: tc.function?.name, input };
    });
    const stopReason = choice?.finish_reason === 'tool_calls' || toolCalls.length ? 'tool_use' : 'end_turn';
    return { text, toolCalls, stopReason };
  },
  async health({ apiKey, baseURL, fetchImpl }) {
    const base = (baseURL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const headers = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    return ping(base + '/models', headers, fetchImpl);
  },
};

export const PROVIDERS = { anthropic: anthropicProvider, openai: openaiProvider };

// Presets shown in the UI. All non-Anthropic providers speak the OpenAI chat
// format. `key`: 'required' | 'none' (local, no key) | 'optional'. `model` and
// `baseURL` are defaults the user can override; blank means "you must set it"
// (local runtimes serve whichever model you loaded, so there is no default).
export const PROVIDER_PRESETS = [
  { id: 'claude', provider: 'anthropic', label: 'Claude (Anthropic)', model: 'claude-opus-4-8', baseURL: '', key: 'required' },
  // Local runtimes (private, offline). Same CORS story as any local server:
  // allow this page's origin, or use the desktop app. LM Studio has a CORS
  // toggle in its server settings; Ollama needs OLLAMA_ORIGINS.
  { id: 'lmstudio', provider: 'openai', label: 'LM Studio (local)', model: '', baseURL: 'http://localhost:1234/v1', key: 'none' },
  { id: 'ollama', provider: 'openai', label: 'Ollama (local)', model: 'llama3.1', baseURL: 'http://localhost:11434/v1', key: 'none' },
  { id: 'llamacpp', provider: 'openai', label: 'llama.cpp server (local)', model: '', baseURL: 'http://localhost:8080/v1', key: 'none' },
  // Hosted free tiers (need a key; browser CORS varies — the desktop app avoids it).
  { id: 'groq', provider: 'openai', label: 'Groq', model: 'llama-3.3-70b-versatile', baseURL: 'https://api.groq.com/openai/v1', key: 'required' },
  { id: 'gemini', provider: 'openai', label: 'Google Gemini', model: 'gemini-2.0-flash', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', key: 'required' },
  { id: 'openrouter', provider: 'openai', label: 'OpenRouter', model: '', baseURL: 'https://openrouter.ai/api/v1', key: 'required' },
  { id: 'mistral', provider: 'openai', label: 'Mistral', model: 'mistral-small-latest', baseURL: 'https://api.mistral.ai/v1', key: 'required' },
  { id: 'openai', provider: 'openai', label: 'OpenAI', model: 'gpt-4o', baseURL: 'https://api.openai.com/v1', key: 'required' },
  { id: 'custom', provider: 'openai', label: 'Custom (OpenAI-compatible)', model: '', baseURL: '', key: 'optional' },
];
