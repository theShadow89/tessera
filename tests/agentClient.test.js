import { describe, it, expect } from 'vitest';
import { runAgent } from '../src/agent/agentClient.js';

// A scripted provider: returns queued normalized responses in order and records
// the normalized messages it was asked to send each time.
function scriptedProvider(responses) {
  const calls = [];
  return {
    calls,
    async chat({ messages }) {
      calls.push(structuredClone(messages));
      return responses.shift();
    },
  };
}

const base = { tools: [], system: 'sys' };

describe('runAgent', () => {
  it('returns the final text when the model does not call tools', async () => {
    const provider = scriptedProvider([{ text: 'Hello there.', toolCalls: [], stopReason: 'end_turn' }]);
    const { text } = await runAgent({
      ...base,
      provider,
      messages: [{ role: 'user', text: 'hi' }],
      executeTool: async () => ({}),
    });
    expect(text).toBe('Hello there.');
    expect(provider.calls).toHaveLength(1);
  });

  it('executes a tool call and feeds the normalized result back', async () => {
    const executed = [];
    const provider = scriptedProvider([
      { text: 'Checking.', toolCalls: [{ id: 'tu_1', name: 'get_state', input: {} }], stopReason: 'tool_use' },
      { text: '8 parts, all fit.', toolCalls: [], stopReason: 'end_turn' },
    ]);
    const { text, messages } = await runAgent({
      ...base,
      provider,
      messages: [{ role: 'user', text: 'split it' }],
      executeTool: async (name, input) => {
        executed.push({ name, input });
        return { loaded: true, partsEstimate: 8 };
      },
    });

    expect(executed).toEqual([{ name: 'get_state', input: {} }]);
    expect(text).toBe('8 parts, all fit.');

    // The second call must include the assistant turn and the tool result.
    const second = provider.calls[1];
    const toolMsg = second.at(-1);
    expect(toolMsg.role).toBe('tool');
    expect(toolMsg.results[0].id).toBe('tu_1');
    expect(JSON.parse(toolMsg.results[0].content)).toMatchObject({ partsEstimate: 8 });

    expect(messages.length).toBe(4); // user, assistant(tool), tool, assistant(final)
  });

  it('captures tool executor errors instead of throwing', async () => {
    const provider = scriptedProvider([
      { text: '', toolCalls: [{ id: 'tu_9', name: 'split', input: {} }], stopReason: 'tool_use' },
      { text: 'That failed.', toolCalls: [], stopReason: 'end_turn' },
    ]);
    const { text } = await runAgent({
      ...base,
      provider,
      messages: [{ role: 'user', text: 'go' }],
      executeTool: async () => {
        throw new Error('no model loaded');
      },
    });
    expect(text).toBe('That failed.');
    expect(JSON.parse(provider.calls[1].at(-1).results[0].content)).toEqual({ error: 'no model loaded' });
  });

  it('stops after the iteration cap when the model never stops calling tools', async () => {
    const provider = {
      async chat() {
        return { text: '', toolCalls: [{ id: 'x', name: 'get_state', input: {} }], stopReason: 'tool_use' };
      },
    };
    const { text } = await runAgent({
      ...base,
      provider,
      messages: [{ role: 'user', text: 'loop' }],
      executeTool: async () => ({}),
    });
    expect(text).toMatch(/too many steps/i);
  });
});
