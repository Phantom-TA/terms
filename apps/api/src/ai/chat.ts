/**
 * A tool-calling conversation turn with a language model, for the Cash Studio's strategist.
 *
 * Unlike a role (one typed answer), a turn is a loop: the model may call server tools, which run
 * here against the owner's data, and then answers, or asks the browser to run a widget tool. Live,
 * recording and replaying implementations share one interface, as for roles, so the demo and CI
 * can replay a recorded turn with no key.
 */
import { StudioScenario, type StudioToolCall } from '@terms/shared';
import {
  generateText,
  type JSONValue,
  jsonSchema,
  type ModelMessage,
  stepCountIs,
  tool,
  type ToolSet,
} from 'ai';
import { type Logger } from 'pino';
import { z } from 'zod';
import {
  AiRoleError,
  classify,
  FixtureStore,
  fixtureDirOf,
  type LiveRunnerOptions,
  type LlmConfig,
  providerModel,
} from './runner.js';

/** A read-only tool the server runs for the model, inside the turn. */
export interface ChatServerTool {
  name: string;
  description: string;
  input: z.ZodType;
  run(input: unknown): Promise<{ output: unknown; summary: string; scenario?: StudioScenario }>;
}

/** A widget action the browser declared; the model may ask for it, the browser runs it. */
export interface ChatClientTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls: StudioToolCall[] }
  | { role: 'tool'; toolCallId: string; toolName: string; output: unknown; isError: boolean };

export interface ChatInput {
  system: string;
  messages: ChatMessage[];
  serverTools: ChatServerTool[];
  clientTools: ChatClientTool[];
  /** Model calls allowed in one turn (each tool round is one more). */
  maxSteps: number;
}

export interface ServerToolTrace {
  name: string;
  input: Record<string, unknown>;
  resultSummary: string;
}

export interface ChatResult {
  content: string;
  /** Client tools the model asked the browser to run. */
  toolCalls: StudioToolCall[];
  serverToolCalls: ServerToolTrace[];
  /** The runway under the last what-if a tool ran this turn. */
  scenario?: StudioScenario | undefined;
}

export const ChatResultSchema = z.object({
  content: z.string(),
  toolCalls: z.array(
    z.object({ id: z.string(), name: z.string(), input: z.record(z.string(), z.unknown()) }),
  ),
  serverToolCalls: z.array(
    z.object({
      name: z.string(),
      input: z.record(z.string(), z.unknown()),
      resultSummary: z.string(),
    }),
  ),
  scenario: StudioScenario.optional(),
});

export interface AiChat {
  turn(input: ChatInput): Promise<ChatResult>;
}

export const DEFAULT_CHAT_TIMEOUT_MS = 45_000;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** A value the model can be shown: plain JSON, whatever it was. */
const toJson = (value: unknown): JSONValue =>
  JSON.parse(JSON.stringify(value ?? null)) as JSONValue;

export function toModelMessages(messages: readonly ChatMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const m of messages) {
    switch (m.role) {
      case 'user':
        out.push({ role: 'user', content: m.content });
        break;
      case 'assistant': {
        const content = [
          ...(m.content === '' ? [] : [{ type: 'text' as const, text: m.content }]),
          ...m.toolCalls.map((c) => ({
            type: 'tool-call' as const,
            toolCallId: c.id,
            toolName: c.name,
            input: c.input,
          })),
        ];
        if (content.length > 0) out.push({ role: 'assistant', content });
        break;
      }
      case 'tool':
        out.push({
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: m.toolCallId,
              toolName: m.toolName,
              output: m.isError
                ? { type: 'error-json', value: toJson(m.output) }
                : { type: 'json', value: toJson(m.output) },
            },
          ],
        });
        break;
    }
  }
  return out;
}

export class LiveChat implements AiChat {
  constructor(
    private readonly llm: LlmConfig,
    private readonly options: LiveRunnerOptions = {},
  ) {}

  async turn(input: ChatInput): Promise<ChatResult> {
    const started = Date.now();
    const model = this.options.model?.('smart') ?? providerModel(this.llm, 'smart');
    const trace: ServerToolTrace[] = [];
    let scenario: StudioScenario | undefined;
    const tools: ToolSet = {};
    for (const t of input.serverTools) {
      tools[t.name] = tool({
        description: t.description,
        inputSchema: t.input,
        execute: async (args: unknown) => {
          try {
            const result = await t.run(args);
            if (result.scenario !== undefined) scenario = result.scenario;
            trace.push({ name: t.name, input: asRecord(args), resultSummary: result.summary });
            return toJson(result.output);
          } catch (err) {
            // The model is told what went wrong and may carry on without the data.
            trace.push({ name: t.name, input: asRecord(args), resultSummary: 'failed' });
            return { error: err instanceof Error ? err.message : 'The tool failed' };
          }
        },
      });
    }
    for (const c of input.clientTools) {
      // No execute: the model's call comes back to us, and goes to the browser.
      tools[c.name] = tool({ description: c.description, inputSchema: jsonSchema(c.inputSchema) });
    }
    try {
      const result = await generateText({
        model,
        instructions: input.system,
        messages: toModelMessages(input.messages),
        tools,
        stopWhen: stepCountIs(input.maxSteps),
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_CHAT_TIMEOUT_MS),
      });
      const clientNames = new Set(input.clientTools.map((c) => c.name));
      const toolCalls = result.toolCalls
        .filter((c) => clientNames.has(c.toolName))
        .map((c) => ({ id: c.toolCallId, name: c.toolName, input: asRecord(c.input) }));
      this.options.logger?.debug({ role: 'studio', ms: Date.now() - started }, 'ai chat turn');
      return {
        content: result.text,
        toolCalls,
        serverToolCalls: trace,
        ...(scenario === undefined ? {} : { scenario }),
      };
    } catch (err) {
      const failure = classify(err, 'studio');
      this.options.logger?.warn(
        { role: 'studio', ms: Date.now() - started, kind: failure.kind },
        'ai chat turn failed',
      );
      throw failure;
    }
  }
}

/** What a turn is keyed by in a fixture: the same conversation and tools find the same file. */
export function chatFixtureCall(input: ChatInput) {
  return {
    role: 'studio',
    tier: 'smart' as const,
    system: input.system,
    prompt: JSON.stringify({
      messages: input.messages,
      serverTools: input.serverTools.map((t) => t.name),
      clientTools: input.clientTools,
    }),
  };
}

export class ReplayChat implements AiChat {
  constructor(private readonly store: FixtureStore) {}

  async turn(input: ChatInput): Promise<ChatResult> {
    const fixture = await this.store.read(chatFixtureCall(input));
    if (fixture === null) {
      throw new AiRoleError(
        'missing_fixture',
        'studio',
        'studio: no recorded turn for this conversation (record one with AI_MODE=record)',
      );
    }
    const parsed = ChatResultSchema.safeParse(fixture.output);
    if (!parsed.success) {
      throw new AiRoleError('invalid', 'studio', 'studio: the recorded turn does not fit', {
        cause: parsed.error,
      });
    }
    return parsed.data;
  }
}

export class RecordingChat implements AiChat {
  constructor(
    private readonly inner: AiChat,
    private readonly store: FixtureStore,
  ) {}

  async turn(input: ChatInput): Promise<ChatResult> {
    const result = await this.inner.turn(input);
    await this.store.write(chatFixtureCall(input), result);
    return result;
  }
}

/** The chat for this configuration, or null when no AI is configured. */
export function buildAiChat(llm: LlmConfig, logger?: Logger): AiChat | null {
  if (!llm.configured && llm.mode !== 'replay') return null;
  const store = new FixtureStore(fixtureDirOf(llm));
  if (llm.mode === 'replay') return new ReplayChat(store);
  const live = new LiveChat(llm, logger === undefined ? {} : { logger });
  return llm.mode === 'record' ? new RecordingChat(live, store) : live;
}
