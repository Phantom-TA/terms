import {
  STUDIO_MAX_CLIENT_TOOLS,
  STUDIO_MAX_MESSAGES,
  type StudioClientToolDefinition,
  type StudioMessage,
  type StudioTurnResponse,
} from '@terms/shared';
import {
  type AgAiAgentRun,
  type AgAiEvent,
  type AgAiMessage,
  type AgAiToolSchema,
} from 'ag-studio';
import { api } from '../../api/client';
import { ApiError } from '../../api/errors';

/**
 * The bridge between AG Studio's agent loop and `POST /api/studio/turn`. Studio owns the loop and
 * runs the widget tools in the page; the server owns the model, its prompt and the read-only cash
 * tools. The browser never sees an LLM key, and only the tools listed here are offered to the model.
 */

const USER_MAX = 4000;
const ASSISTANT_MAX = 8000;
const DESCRIPTION_MAX = 1000;

function parseArgs(json: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(json);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseOutput(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return content;
  }
}

/**
 * Studio's conversation in the contract's shape. The system prompt is the server's, so Studio's
 * system and developer messages are not sent. The newest messages are kept, starting at a user
 * message so a tool result is never sent without the call it answers.
 */
export function toStudioMessages(messages: readonly AgAiMessage[]): StudioMessage[] {
  const out: StudioMessage[] = [];
  for (const m of messages) {
    switch (m.role) {
      case 'user': {
        const content = m.content.trim().slice(0, USER_MAX);
        if (content) out.push({ role: 'user', content });
        break;
      }
      case 'assistant':
        out.push({
          role: 'assistant',
          content: (m.content ?? '').slice(0, ASSISTANT_MAX),
          toolCalls: (m.toolCalls ?? []).map((call) => ({
            id: call.id,
            name: call.function.name,
            input: parseArgs(call.function.arguments),
          })),
        });
        break;
      case 'tool':
        out.push({
          role: 'tool',
          toolCallId: m.toolCallId,
          output: m.error ?? parseOutput(m.content),
          isError: m.error !== undefined,
        });
        break;
      default:
        break;
    }
  }
  let start = Math.max(0, out.length - STUDIO_MAX_MESSAGES);
  while (start < out.length && out[start]?.role !== 'user') start += 1;
  return out.slice(start);
}

/**
 * One tool as the contract declares it. A description over the contract's limit is not cut: it is
 * shortened, and the whole text goes in the input schema's own `description`, which has no limit.
 */
function toClientTool(tool: AgAiToolSchema): StudioClientToolDefinition {
  if (tool.description.length <= DESCRIPTION_MAX) {
    return { name: tool.name, description: tool.description, inputSchema: tool.parameters };
  }
  const note = ' … (The full description is in the input schema.)';
  return {
    name: tool.name,
    description: tool.description.slice(0, DESCRIPTION_MAX - note.length).trimEnd() + note,
    inputSchema: { ...tool.parameters, description: tool.description },
  };
}

/** The widget tools the browser runs, as the contract declares them. Server-side tools are left out. */
export function toClientTools(tools: readonly AgAiToolSchema[]): StudioClientToolDefinition[] {
  return tools
    .filter((tool) => tool.kind === undefined || tool.kind === 'client')
    .slice(0, STUDIO_MAX_CLIENT_TOOLS)
    .map(toClientTool);
}

/**
 * One answer from the server as Studio's events: what the server read for the model (shown as the
 * agent's working), its words, then the widget calls for Studio to run.
 */
export function responseEvents(
  response: StudioTurnResponse,
  newId: () => string = () => crypto.randomUUID(),
): AgAiEvent[] {
  const events: AgAiEvent[] = [];
  if (response.serverToolCalls.length > 0) {
    const messageId = newId();
    const lines = response.serverToolCalls.map((call) => `${call.name}: ${call.resultSummary}`);
    events.push(
      { type: 'REASONING_MESSAGE_START', messageId, role: 'reasoning' },
      { type: 'REASONING_MESSAGE_CONTENT', messageId, delta: lines.join('\n') },
      { type: 'REASONING_MESSAGE_END', messageId },
    );
  }
  const messageId = newId();
  const { content, toolCalls } = response.message;
  if (content) {
    events.push(
      { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: content },
      { type: 'TEXT_MESSAGE_END', messageId },
    );
  }
  for (const call of toolCalls) {
    events.push(
      {
        type: 'TOOL_CALL_START',
        toolCallId: call.id,
        toolCallName: call.name,
        parentMessageId: messageId,
      },
      { type: 'TOOL_CALL_ARGS', toolCallId: call.id, delta: JSON.stringify(call.input) },
      { type: 'TOOL_CALL_END', toolCallId: call.id },
    );
  }
  return events;
}

/** Why a turn failed, in words for the chat panel. */
export function turnErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'NOT_CONFIGURED')
      return `The cash strategist isn’t available yet. ${error.message}`;
    if (error.code === 'RATE_LIMITED' || error.status === 429)
      return 'Too many questions in a minute. Wait a moment, then ask again.';
    return error.requestId ? `${error.message} (request ${error.requestId})` : error.message;
  }
  return 'The cash strategist could not answer. Try again.';
}

/** One round of the cash strategist: the conversation and its widget tools to the server, events back. */
export const runTurn: AgAiAgentRun = async function* (input, ctx) {
  const messages = toStudioMessages(input.messages);
  if (messages.length === 0) return;
  try {
    const response = await api('studioTurn', {
      body: { messages, clientTools: toClientTools(input.tools) },
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });
    yield* responseEvents(response);
  } catch (error) {
    // A run the owner stopped ends quietly; Studio already knows it stopped. The signal is checked
    // rather than the error, whose type depends on where fetch runs.
    if (ctx.signal?.aborted) return;
    yield {
      type: 'RUN_ERROR',
      message: turnErrorMessage(error),
      ...(error instanceof ApiError && error.code ? { code: error.code } : {}),
    };
  }
};
