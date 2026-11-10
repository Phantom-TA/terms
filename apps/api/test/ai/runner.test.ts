import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AiRoleError,
  buildAiRunner,
  FixtureStore,
  fixtureDirOf,
  fixtureKey,
  LiveRunner,
  type LlmConfig,
  providerModel,
  RecordingRunner,
  ReplayRunner,
  type RoleCall,
} from '../../src/ai/runner.js';

const Answer = z.object({ move: z.enum(['ACCEPT', 'COUNTER']), pct: z.number() });
type Answer = z.infer<typeof Answer>;

const call: RoleCall<Answer> = {
  role: 'client-negotiator',
  tier: 'smart',
  system: 'You negotiate.',
  prompt: 'Offer: 1.0%',
  schema: Answer,
};

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

/** A model that answers with fixed text. */
function textModel(text: string) {
  return new MockLanguageModelV4({
    doGenerate: () =>
      Promise.resolve({
        content: [{ type: 'text' as const, text }],
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage,
        warnings: [],
      }),
  });
}

const llm = (over: Partial<LlmConfig> = {}): LlmConfig => ({
  provider: 'anthropic',
  apiKey: 'test-key',
  model: 'smart-model',
  fastModel: 'fast-model',
  mode: 'live',
  negotiation: 'ai',
  fixtureDir: mkdtempSync(join(tmpdir(), 'terms-ai-')),
  configured: true,
  ...over,
});

describe('LiveRunner', () => {
  it('returns an answer that fits the role’s schema, using the tier’s model', async () => {
    const tiers: string[] = [];
    const runner = new LiveRunner(llm(), {
      model: (tier) => {
        tiers.push(tier);
        return textModel('{"move":"COUNTER","pct":1.5}');
      },
    });
    expect(await runner.run(call)).toEqual({ move: 'COUNTER', pct: 1.5 });
    expect(await runner.run({ ...call, tier: 'fast' })).toEqual({ move: 'COUNTER', pct: 1.5 });
    expect(tiers).toEqual(['smart', 'fast']);
  });

  it('refuses an answer that does not fit the schema', async () => {
    const runner = new LiveRunner(llm(), {
      model: () => textModel('{"move":"HAGGLE","pct":"lots"}'),
    });
    await expect(runner.run(call)).rejects.toMatchObject({
      name: 'AiRoleError',
      kind: 'invalid',
      role: 'client-negotiator',
    });
    const notJson = new LiveRunner(llm(), { model: () => textModel('I would accept.') });
    await expect(notJson.run(call)).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('reports a provider failure', async () => {
    const runner = new LiveRunner(llm(), {
      model: () =>
        new MockLanguageModelV4({
          doGenerate: () => Promise.reject(new Error('503 overloaded')),
        }),
    });
    const error = await runner.run(call).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiRoleError);
    expect(error).toMatchObject({ kind: 'provider' });
  });

  it('gives up when the provider is too slow', async () => {
    const runner = new LiveRunner(llm(), {
      timeoutMs: 20,
      model: () =>
        new MockLanguageModelV4({
          doGenerate: ({ abortSignal }) =>
            new Promise((_resolve, reject) => {
              abortSignal?.addEventListener(
                'abort',
                () => {
                  reject(
                    abortSignal.reason instanceof Error ? abortSignal.reason : new Error('aborted'),
                  );
                },
                { once: true },
              );
            }),
        }),
    });
    await expect(runner.run(call)).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('builds a model for each provider and tier', () => {
    for (const provider of ['anthropic', 'openai', 'google'] as const) {
      const smart = providerModel(llm({ provider }), 'smart');
      const fast = providerModel(llm({ provider }), 'fast');
      expect(smart).toMatchObject({ modelId: 'smart-model' });
      expect(fast).toMatchObject({ modelId: 'fast-model' });
    }
  });
});

describe('recorded answers', () => {
  it('keys a fixture by role, tier, system and prompt', () => {
    expect(fixtureKey(call)).toBe(fixtureKey({ ...call }));
    expect(fixtureKey(call)).toMatch(/^[0-9a-f]{20}$/);
    for (const other of [
      { ...call, role: 'supplier-negotiator' },
      { ...call, tier: 'fast' as const },
      { ...call, system: 'You negotiate well.' },
      { ...call, prompt: 'Offer: 1.1%' },
    ]) {
      expect(fixtureKey(other)).not.toBe(fixtureKey(call));
    }
  });

  it('records a live answer, then replays it without a model', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'terms-ai-'));
    const store = new FixtureStore(dir);
    const live = new LiveRunner(llm(), { model: () => textModel('{"move":"ACCEPT","pct":0.8}') });
    expect(await new RecordingRunner(live, store).run(call)).toEqual({ move: 'ACCEPT', pct: 0.8 });

    const saved = readdirSync(join(dir, 'client-negotiator'));
    expect(saved).toEqual([`${fixtureKey(call)}.json`]);
    const file = JSON.parse(
      readFileSync(join(dir, 'client-negotiator', saved[0] ?? ''), 'utf8'),
    ) as Record<string, unknown>;
    expect(file).toMatchObject({ role: 'client-negotiator', prompt: 'Offer: 1.0%' });

    expect(await new ReplayRunner(store).run(call)).toEqual({ move: 'ACCEPT', pct: 0.8 });
  });

  it('says so when a prompt has no recording, and rejects a recording that no longer fits', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'terms-ai-'));
    const store = new FixtureStore(dir);
    const replay = new ReplayRunner(store);
    await expect(replay.run(call)).rejects.toMatchObject({ kind: 'missing_fixture' });

    await store.write(call, { move: 'HAGGLE' });
    await expect(replay.run(call)).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('does not record a failed call', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'terms-ai-'));
    const broken = new LiveRunner(llm(), { model: () => textModel('nope') });
    await expect(new RecordingRunner(broken, new FixtureStore(dir)).run(call)).rejects.toThrow();
    expect(readdirSync(dir)).toEqual([]);
  });

  it('reads an unreadable fixture as an error, not as a missing one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'terms-ai-'));
    const store = new FixtureStore(dir);
    await store.write(call, { move: 'ACCEPT', pct: 1 });
    const file = join(dir, 'client-negotiator', `${fixtureKey(call)}.json`);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(file, '{broken');
    await expect(store.read(call)).rejects.toThrow();
  });
});

describe('buildAiRunner', () => {
  it('is off without a key, and replays without one', () => {
    expect(buildAiRunner(llm({ apiKey: null, configured: false }))).toBeNull();
    expect(buildAiRunner(llm({ apiKey: null, configured: false, mode: 'record' }))).toBeNull();
    expect(buildAiRunner(llm({ apiKey: null, configured: true, mode: 'replay' }))).toBeInstanceOf(
      ReplayRunner,
    );
  });

  it('is live, or live and recording, with a key', () => {
    expect(buildAiRunner(llm())).toBeInstanceOf(LiveRunner);
    expect(buildAiRunner(llm({ mode: 'record' }))).toBeInstanceOf(RecordingRunner);
  });

  it('finds a relative fixture directory from the repository root', () => {
    const dir = fixtureDirOf(llm({ fixtureDir: 'apps/api/test/fixtures/ai' }));
    expect(dir.replaceAll('\\', '/')).toMatch(/\/apps\/api\/test\/fixtures\/ai$/);
    expect(fixtureDirOf(llm({ fixtureDir: '/abs/path' })).replaceAll('\\', '/')).toMatch(
      /\/abs\/path$/,
    );
  });
});
