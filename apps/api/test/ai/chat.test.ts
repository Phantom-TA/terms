import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  buildAiChat,
  type ChatInput,
  type ChatServerTool,
  chatFixtureCall,
  LiveChat,
  RecordingChat,
  ReplayChat,
  toModelMessages,
} from '../../src/ai/chat.js';
import { FixtureStore, type LlmConfig } from '../../src/ai/runner.js';

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const stop = { unified: 'stop' as const, raw: undefined };
const toolCalls = { unified: 'tool-calls' as const, raw: undefined };

const text = (t: string) => ({
  content: [{ type: 'text' as const, text: t }],
  finishReason: stop,
  usage,
  warnings: [],
});
const call = (id: string, name: string, input: unknown) => ({
  content: [
    { type: 'tool-call' as const, toolCallId: id, toolName: name, input: JSON.stringify(input) },
  ],
  finishReason: toolCalls,
  usage,
  warnings: [],
});

const llm = (): LlmConfig => ({
  provider: 'anthropic',
  apiKey: 'k',
  model: 'm',
  fastModel: 'f',
  mode: 'live',
  negotiation: 'ai',
  fixtureDir: mkdtempSync(join(tmpdir(), 'terms-chat-')),
  configured: true,
});

function serverTool(run: ChatServerTool['run']): ChatServerTool {
  return {
    name: 'get_plan_summary',
    description: 'The plan.',
    input: z.object({ limit: z.number().optional() }),
    run,
  };
}

const input = (over: Partial<ChatInput> = {}): ChatInput => ({
  system: 'You are a strategist.',
  messages: [{ role: 'user', content: 'How are we doing?' }],
  serverTools: [
    serverTool(() => Promise.resolve({ output: { gap: '6200.00' }, summary: 'gap 6200' })),
  ],
  clientTools: [
    {
      name: 'add_chart',
      description: 'Add a chart.',
      inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
    },
  ],
  maxSteps: 5,
  ...over,
});

describe('LiveChat', () => {
  it('runs a server tool, then answers with what it found', async () => {
    const seen: string[] = [];
    const model = new MockLanguageModelV4({
      doGenerate: [call('c1', 'get_plan_summary', { limit: 3 }), text('You need $6,200.')],
    });
    const chat = new LiveChat(llm(), { model: () => model });
    const result = await chat.turn(
      input({
        serverTools: [
          serverTool((args) => {
            seen.push(JSON.stringify(args));
            return Promise.resolve({ output: { gap: '6200.00' }, summary: 'gap 6200' });
          }),
        ],
      }),
    );
    expect(seen).toEqual(['{"limit":3}']);
    expect(result).toEqual({
      content: 'You need $6,200.',
      toolCalls: [],
      serverToolCalls: [
        { name: 'get_plan_summary', input: { limit: 3 }, resultSummary: 'gap 6200' },
      ],
    });
    expect(model.doGenerateCalls).toHaveLength(2);
    // The model was offered both kinds of tool, and the result went back to it as data.
    const names = (model.doGenerateCalls[0]?.tools ?? []).map((t) => t.name).sort();
    expect(names).toEqual(['add_chart', 'get_plan_summary']);
    expect(JSON.stringify(model.doGenerateCalls[1]?.prompt)).toContain('6200.00');
  });

  it('hands a screen tool call back to the caller instead of running it', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [call('c9', 'add_chart', { title: 'Runway' })],
    });
    const result = await new LiveChat(llm(), { model: () => model }).turn(input());
    expect(result.toolCalls).toEqual([{ id: 'c9', name: 'add_chart', input: { title: 'Runway' } }]);
    expect(result.serverToolCalls).toEqual([]);
    expect(model.doGenerateCalls).toHaveLength(1); // it stopped: the browser has to answer
  });

  it('tells the model when a data tool fails, and carries on', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [call('c1', 'get_plan_summary', {}), text('I could not read the plan.')],
    });
    const result = await new LiveChat(llm(), { model: () => model }).turn(
      input({ serverTools: [serverTool(() => Promise.reject(new Error('No goal yet')))] }),
    );
    expect(result.content).toBe('I could not read the plan.');
    expect(result.serverToolCalls).toEqual([
      { name: 'get_plan_summary', input: {}, resultSummary: 'failed' },
    ]);
    expect(JSON.stringify(model.doGenerateCalls[1]?.prompt)).toContain('No goal yet');
  });

  it('stops after the step limit', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: () => Promise.resolve(call('c', 'get_plan_summary', {})),
    });
    await new LiveChat(llm(), { model: () => model }).turn(input({ maxSteps: 2 }));
    expect(model.doGenerateCalls).toHaveLength(2);
  });

  it('reports a provider failure and a timeout as typed errors', async () => {
    const failing = new MockLanguageModelV4({ doGenerate: () => Promise.reject(new Error('503')) });
    await expect(new LiveChat(llm(), { model: () => failing }).turn(input())).rejects.toMatchObject(
      {
        name: 'AiRoleError',
        kind: 'provider',
        role: 'studio',
      },
    );
    const slow = new MockLanguageModelV4({
      doGenerate: ({ abortSignal }) =>
        new Promise((_resolve, reject) => {
          abortSignal?.addEventListener(
            'abort',
            () => {
              reject(abortSignal.reason instanceof Error ? abortSignal.reason : new Error('x'));
            },
            { once: true },
          );
        }),
    });
    await expect(
      new LiveChat(llm(), { model: () => slow, timeoutMs: 20 }).turn(input()),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });
});

describe('toModelMessages', () => {
  it('maps the conversation, tying each result to its call and keeping errors as errors', () => {
    const messages = toModelMessages([
      { role: 'user', content: 'Chart it' },
      {
        role: 'assistant',
        content: 'Adding one.',
        toolCalls: [{ id: 'c1', name: 'add_chart', input: { title: 'Runway' } }],
      },
      {
        role: 'tool',
        toolCallId: 'c1',
        toolName: 'add_chart',
        output: { ok: true },
        isError: false,
      },
      { role: 'tool', toolCallId: 'c1', toolName: 'add_chart', output: 'boom', isError: true },
      { role: 'assistant', content: '', toolCalls: [] }, // says nothing: left out
    ]);
    expect(messages).toHaveLength(4);
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Adding one.' },
        { type: 'tool-call', toolCallId: 'c1', toolName: 'add_chart', input: { title: 'Runway' } },
      ],
    });
    expect(messages[2]).toMatchObject({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolName: 'add_chart',
          output: { type: 'json', value: { ok: true } },
        },
      ],
    });
    expect(messages[3]).toMatchObject({
      content: [{ output: { type: 'error-json', value: 'boom' } }],
    });
  });
});

describe('recorded turns', () => {
  const result = { content: 'Hi', toolCalls: [], serverToolCalls: [] };

  it('keys a turn by its conversation and tools', () => {
    const a = chatFixtureCall(input());
    expect(a).toMatchObject({ role: 'studio', tier: 'smart' });
    expect(chatFixtureCall(input())).toEqual(a);
    expect(
      chatFixtureCall(input({ messages: [{ role: 'user', content: 'Other' }] })).prompt,
    ).not.toBe(a.prompt);
    expect(chatFixtureCall(input({ clientTools: [] })).prompt).not.toBe(a.prompt);
  });

  it('records a live turn, then replays it with no model', async () => {
    const store = new FixtureStore(mkdtempSync(join(tmpdir(), 'terms-chat-')));
    const live = new LiveChat(llm(), {
      model: () => new MockLanguageModelV4({ doGenerate: [text('Hi')] }),
    });
    expect(await new RecordingChat(live, store).turn(input())).toEqual(result);
    expect(await new ReplayChat(store).turn(input())).toEqual(result);
  });

  it('says so when a conversation has no recording, or the recording no longer fits', async () => {
    const store = new FixtureStore(mkdtempSync(join(tmpdir(), 'terms-chat-')));
    await expect(new ReplayChat(store).turn(input())).rejects.toMatchObject({
      kind: 'missing_fixture',
    });
    await store.write(chatFixtureCall(input()), { content: 7 });
    await expect(new ReplayChat(store).turn(input())).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('builds the right chat for each mode, and none without AI', () => {
    expect(buildAiChat({ ...llm(), apiKey: null, configured: false })).toBeNull();
    expect(
      buildAiChat({ ...llm(), apiKey: null, configured: true, mode: 'replay' }),
    ).toBeInstanceOf(ReplayChat);
    expect(buildAiChat(llm())).toBeInstanceOf(LiveChat);
    expect(buildAiChat({ ...llm(), mode: 'record' })).toBeInstanceOf(RecordingChat);
  });
});

describe('a what-if scenario from a tool', () => {
  const scenario = { label: 'Discounts capped at 1.00%', points: [] };
  const withScenario = serverTool(() =>
    Promise.resolve({ output: { ok: true }, summary: 'what-if', scenario }),
  );

  it('is carried out of the turn, and recorded with it', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [call('c1', 'get_plan_summary', {}), text('Capped at 1%, you commit less.')],
    });
    const result = await new LiveChat(llm(), { model: () => model }).turn(
      input({ serverTools: [withScenario] }),
    );
    expect(result.scenario).toEqual(scenario);

    const store = new FixtureStore(mkdtempSync(join(tmpdir(), 'terms-chat-')));
    const recording = new RecordingChat(
      new LiveChat(llm(), {
        model: () =>
          new MockLanguageModelV4({
            doGenerate: [call('c1', 'get_plan_summary', {}), text('Done.')],
          }),
      }),
      store,
    );
    await recording.turn(input({ serverTools: [withScenario] }));
    const replayed = await new ReplayChat(store).turn(input({ serverTools: [withScenario] }));
    expect(replayed.scenario).toEqual(scenario);
  });

  it('is absent when no tool produced one', async () => {
    const model = new MockLanguageModelV4({ doGenerate: [text('Hello.')] });
    const result = await new LiveChat(llm(), { model: () => model }).turn(input());
    expect('scenario' in result).toBe(false);
  });
});
