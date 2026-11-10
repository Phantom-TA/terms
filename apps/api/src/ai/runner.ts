/**
 * The seam between Terms and a language model (CONTEXT.md, AI architecture).
 *
 * Every AI role asks for one thing: a typed answer to a prompt. `AiRunner` is that seam, with three
 * implementations that share one contract:
 *
 * - `LiveRunner` calls the configured provider through the Vercel AI SDK and returns the answer only
 *   if it parses against the role's zod schema.
 * - `RecordingRunner` wraps a live runner and saves every answer as a fixture.
 * - `ReplayRunner` answers from saved fixtures, so CI, the seeded demo and tests need no key.
 *
 * A runner never returns an unvalidated answer and never hides a failure: it throws `AiRoleError`
 * and the role decides what to do (every role has a deterministic fallback or a clear message).
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogle } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, type LanguageModel, NoObjectGeneratedError, Output } from 'ai';
import { existsSync } from 'node:fs';
import { type Logger } from 'pino';
import { type z } from 'zod';
import { type Config } from '../config.js';

/** `smart` is for decisions (negotiators, parsers); `fast` is for explanations and drafting. */
export type Tier = 'smart' | 'fast';

export interface RoleCall<T> {
  /** The role's name, used in fixtures and logs. */
  role: string;
  tier: Tier;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
}

export interface AiRunner {
  run<T>(call: RoleCall<T>): Promise<T>;
}

export type AiFailure = 'provider' | 'timeout' | 'invalid' | 'missing_fixture';

export class AiRoleError extends Error {
  constructor(
    readonly kind: AiFailure,
    readonly role: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AiRoleError';
  }
}

export type LlmConfig = Config['llm'];

/** The provider's model for a tier. */
export function providerModel(llm: LlmConfig, tier: Tier): LanguageModel {
  const id = tier === 'smart' ? llm.model : llm.fastModel;
  // Without a key the SDK reads the provider's own environment variable, which is what we want.
  const settings = llm.apiKey === null ? {} : { apiKey: llm.apiKey };
  switch (llm.provider) {
    case 'anthropic':
      return createAnthropic(settings)(id);
    case 'openai':
      return createOpenAI(settings)(id);
    case 'google':
      return createGoogle(settings)(id);
  }
}

export interface LiveRunnerOptions {
  /** Test seam: the model to use for a tier instead of the provider's. */
  model?: (tier: Tier) => LanguageModel;
  /** One call's budget. A negotiation turn must not hang on a slow provider. */
  timeoutMs?: number;
  logger?: Logger;
}

export const DEFAULT_AI_TIMEOUT_MS = 25_000;

export class LiveRunner implements AiRunner {
  constructor(
    private readonly llm: LlmConfig,
    private readonly options: LiveRunnerOptions = {},
  ) {}

  async run<T>(call: RoleCall<T>): Promise<T> {
    const started = Date.now();
    const model = this.options.model?.(call.tier) ?? providerModel(this.llm, call.tier);
    try {
      const { output } = await generateText({
        model,
        instructions: call.system,
        prompt: call.prompt,
        output: Output.object({ schema: call.schema }),
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS),
      });
      const parsed = call.schema.safeParse(output);
      if (!parsed.success) {
        throw new AiRoleError('invalid', call.role, `${call.role}: the answer does not fit`, {
          cause: parsed.error,
        });
      }
      this.options.logger?.debug({ role: call.role, ms: Date.now() - started }, 'ai call');
      return parsed.data;
    } catch (err) {
      const failure = classify(err, call.role);
      this.options.logger?.warn(
        { role: call.role, ms: Date.now() - started, kind: failure.kind },
        'ai call failed',
      );
      throw failure;
    }
  }
}

/** A failure from the SDK or provider as one of ours. */
export function classify(err: unknown, role: string): AiRoleError {
  if (err instanceof AiRoleError) return err;
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return new AiRoleError('timeout', role, `${role}: the model took too long`, { cause: err });
  }
  if (NoObjectGeneratedError.isInstance(err)) {
    return new AiRoleError('invalid', role, `${role}: the model did not return a valid answer`, {
      cause: err,
    });
  }
  return new AiRoleError('provider', role, `${role}: the model provider failed`, { cause: err });
}

// ------------------------------------------------------------------ recorded answers

/** What a recorded answer is keyed by: the same role, tier and text always find the same file. */
export function fixtureKey(call: Pick<RoleCall<unknown>, 'role' | 'tier' | 'system' | 'prompt'>) {
  return createHash('sha256')
    .update(JSON.stringify([call.role, call.tier, call.system, call.prompt]))
    .digest('hex')
    .slice(0, 20);
}

interface Fixture {
  role: string;
  tier: Tier;
  system: string;
  prompt: string;
  output: unknown;
}

export class FixtureStore {
  constructor(private readonly dir: string) {}

  private file(call: Pick<RoleCall<unknown>, 'role' | 'tier' | 'system' | 'prompt'>): string {
    return join(this.dir, call.role, `${fixtureKey(call)}.json`);
  }

  async read(call: Pick<RoleCall<unknown>, 'role' | 'tier' | 'system' | 'prompt'>) {
    try {
      return JSON.parse(await readFile(this.file(call), 'utf8')) as Fixture;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async write(
    call: Pick<RoleCall<unknown>, 'role' | 'tier' | 'system' | 'prompt'>,
    output: unknown,
  ): Promise<void> {
    const file = this.file(call);
    await mkdir(dirname(file), { recursive: true });
    const fixture: Fixture = {
      role: call.role,
      tier: call.tier,
      system: call.system,
      prompt: call.prompt,
      output,
    };
    await writeFile(file, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
  }
}

export class ReplayRunner implements AiRunner {
  constructor(private readonly store: FixtureStore) {}

  async run<T>(call: RoleCall<T>): Promise<T> {
    const fixture = await this.store.read(call);
    if (fixture === null) {
      throw new AiRoleError(
        'missing_fixture',
        call.role,
        `${call.role}: no recorded answer for this prompt (record one with AI_MODE=record)`,
      );
    }
    const parsed = call.schema.safeParse(fixture.output);
    if (!parsed.success) {
      throw new AiRoleError(
        'invalid',
        call.role,
        `${call.role}: the recorded answer does not fit`,
        {
          cause: parsed.error,
        },
      );
    }
    return parsed.data;
  }
}

export class RecordingRunner implements AiRunner {
  constructor(
    private readonly inner: AiRunner,
    private readonly store: FixtureStore,
  ) {}

  async run<T>(call: RoleCall<T>): Promise<T> {
    const output = await this.inner.run(call);
    await this.store.write(call, output);
    return output;
  }
}

// ------------------------------------------------------------------ wiring

/** The repository root: the nearest parent holding pnpm-workspace.yaml. */
function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

export function fixtureDirOf(llm: LlmConfig): string {
  return isAbsolute(llm.fixtureDir) ? llm.fixtureDir : resolve(repoRoot(), llm.fixtureDir);
}

/** The runner for this configuration, or null when no AI is configured (roles then fall back). */
export function buildAiRunner(llm: LlmConfig, logger?: Logger): AiRunner | null {
  if (!llm.configured && llm.mode !== 'replay') return null;
  const store = new FixtureStore(fixtureDirOf(llm));
  if (llm.mode === 'replay') return new ReplayRunner(store);
  const live = new LiveRunner(llm, logger === undefined ? {} : { logger });
  return llm.mode === 'record' ? new RecordingRunner(live, store) : live;
}
