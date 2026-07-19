// Provider-agnostic agent loop. Maintains a normalized conversation (see
// providers.js), asks the provider for the next step, executes any tool calls
// against the app, feeds results back, and repeats until the model stops.

const MAX_ITERATIONS = 8;

/**
 * Run the agent to completion.
 *
 * @param {object} opts
 * @param {object} opts.provider  a provider from providers.js (has .chat)
 * @param {object} opts.providerOpts  { apiKey, baseURL, model, maxTokens, fetchImpl }
 * @param {Array} opts.messages  normalized conversation so far
 * @param {(name:string, input:object)=>Promise<object>} opts.executeTool
 * @param {object[]} opts.tools  tool schemas (provider-neutral JSON schema)
 * @param {string} opts.system
 * @param {(ev:object)=>void} [opts.onEvent]
 * @returns {Promise<{messages:Array, text:string}>}
 */
export async function runAgent({
  provider,
  providerOpts = {},
  messages,
  executeTool,
  tools,
  system,
  onEvent = () => {},
}) {
  const convo = [...messages];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const { text, toolCalls, stopReason } = await provider.chat({
      ...providerOpts,
      system,
      tools,
      messages: convo,
    });

    convo.push({ role: 'assistant', text, toolCalls: toolCalls || [] });
    if (text) onEvent({ type: 'text', text });

    if (stopReason !== 'tool_use' || !toolCalls || toolCalls.length === 0) {
      return { messages: convo, text };
    }

    const results = [];
    for (const call of toolCalls) {
      onEvent({ type: 'tool', name: call.name, input: call.input });
      let result;
      try {
        result = await executeTool(call.name, call.input);
      } catch (err) {
        result = { error: err.message || String(err) };
      }
      results.push({ id: call.id, name: call.name, content: JSON.stringify(result) });
    }
    convo.push({ role: 'tool', results });
  }

  return { messages: convo, text: 'Stopped: too many steps. Please refine the request.' };
}
