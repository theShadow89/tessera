import { describe, it, expect } from 'vitest';
import { anthropicProvider, openaiProvider } from '../src/agent/providers.js';

const TOOLS = [
  { name: 'get_state', description: 'read state', input_schema: { type: 'object', properties: {} } },
];

// A fetch stub that records the request body and returns a canned response.
function stubFetch(responseJson) {
  const seen = {};
  const impl = async (url, opts) => {
    seen.url = url;
    seen.headers = opts.headers;
    seen.body = JSON.parse(opts.body);
    return { ok: true, json: async () => responseJson };
  };
  impl.seen = seen;
  return impl;
}

const convo = [
  { role: 'user', text: 'hi' },
  { role: 'assistant', text: 'checking', toolCalls: [{ id: 'c1', name: 'get_state', input: {} }] },
  { role: 'tool', results: [{ id: 'c1', name: 'get_state', content: '{"loaded":true}' }] },
];

describe('anthropicProvider', () => {
  it('formats tools/messages and parses a tool_use response', async () => {
    const fetchImpl = stubFetch({
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'ok' },
        { type: 'tool_use', id: 'tu_1', name: 'split', input: { a: 1 } },
      ],
    });
    const out = await anthropicProvider.chat({
      apiKey: 'k',
      model: 'claude-opus-4-8',
      system: 'sys',
      tools: TOOLS,
      messages: convo,
      fetchImpl,
    });

    // Wire format: tools carry input_schema; tool result goes in a user turn.
    expect(fetchImpl.seen.url).toMatch(/\/v1\/messages$/);
    expect(fetchImpl.seen.headers['x-api-key']).toBe('k');
    expect(fetchImpl.seen.body.tools[0].input_schema).toBeDefined();
    const wireMsgs = fetchImpl.seen.body.messages;
    expect(wireMsgs[1].content.find((b) => b.type === 'tool_use').id).toBe('c1');
    expect(wireMsgs[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'c1' });

    // Parsed normalized response.
    expect(out.text).toBe('ok');
    expect(out.stopReason).toBe('tool_use');
    expect(out.toolCalls).toEqual([{ id: 'tu_1', name: 'split', input: { a: 1 } }]);
  });
});

describe('openaiProvider', () => {
  it('formats tools/messages and parses a tool_calls response', async () => {
    const fetchImpl = stubFetch({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: '',
            tool_calls: [{ id: 'call_9', type: 'function', function: { name: 'split', arguments: '{"a":2}' } }],
          },
        },
      ],
    });
    const out = await openaiProvider.chat({
      baseURL: 'http://localhost:11434/v1',
      model: 'llama3.1',
      system: 'sys',
      tools: TOOLS,
      messages: convo,
      fetchImpl,
    });

    // Wire format: function tools; system first; tool result as role:'tool'.
    expect(fetchImpl.seen.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(fetchImpl.seen.body.tools[0]).toMatchObject({ type: 'function' });
    expect(fetchImpl.seen.body.tools[0].function.parameters).toBeDefined();
    const wireMsgs = fetchImpl.seen.body.messages;
    expect(wireMsgs[0].role).toBe('system');
    expect(wireMsgs[2].tool_calls[0].function.name).toBe('get_state');
    expect(wireMsgs[3]).toMatchObject({ role: 'tool', tool_call_id: 'c1' });

    // Parsed normalized response (arguments string -> object).
    expect(out.stopReason).toBe('tool_use');
    expect(out.toolCalls).toEqual([{ id: 'call_9', name: 'split', input: { a: 2 } }]);
  });

  it('omits the Authorization header when no key is given (Ollama)', async () => {
    const fetchImpl = stubFetch({ choices: [{ finish_reason: 'stop', message: { content: 'hi' } }] });
    const out = await openaiProvider.chat({
      baseURL: 'http://localhost:11434/v1',
      model: 'llama3.1',
      system: 'sys',
      tools: TOOLS,
      messages: [{ role: 'user', text: 'hi' }],
      fetchImpl,
    });
    expect(fetchImpl.seen.headers.Authorization).toBeUndefined();
    expect(out.text).toBe('hi');
    expect(out.stopReason).toBe('end_turn');
  });
});
