import { z } from 'zod';

/**
 * POST /api/studio/turn — one turn of the AG Studio "cash strategist" agent.
 *
 * The agent loop runs in the browser; the LLM is called only through this endpoint (no key in
 * the browser). Two kinds of tools exist:
 * - server tools: read-only data tools executed on the server inside the turn (listed below);
 * - client tools: AG Studio widget actions the browser declares and executes itself.
 * The model can only call tools in these two sets; anything else is rejected.
 */

/** Read-only data tools the server runs for the strategist. */
export const StudioServerTool = z.enum([
  'get_open_invoices',
  'get_cash_runway',
  'get_plan_summary',
  'get_cash_history',
  'simulate_discount_cap',
]);
export type StudioServerTool = z.infer<typeof StudioServerTool>;

export const STUDIO_MAX_MESSAGES = 60;
export const STUDIO_MAX_CLIENT_TOOLS = 64;

const ToolName = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);

export const StudioToolCall = z.object({
  id: z.string().min(1).max(128),
  name: ToolName,
  input: z.record(z.string(), z.unknown()),
});
export type StudioToolCall = z.infer<typeof StudioToolCall>;

export const StudioMessage = z.discriminatedUnion('role', [
  z.strictObject({ role: z.literal('user'), content: z.string().min(1).max(4000) }),
  z.strictObject({
    role: z.literal('assistant'),
    content: z.string().max(8000),
    toolCalls: z.array(StudioToolCall).max(16).default([]),
  }),
  z.strictObject({
    role: z.literal('tool'),
    toolCallId: z.string().min(1).max(128),
    /** JSON-serialisable result of a client tool the browser executed. */
    output: z.unknown(),
    isError: z.boolean().default(false),
  }),
]);
export type StudioMessage = z.infer<typeof StudioMessage>;

/** A widget action the browser exposes to the model. `inputSchema` is a JSON Schema object. */
export const StudioClientToolDefinition = z.strictObject({
  name: ToolName,
  description: z.string().min(1).max(1000),
  inputSchema: z.record(z.string(), z.unknown()),
});
export type StudioClientToolDefinition = z.infer<typeof StudioClientToolDefinition>;

export const StudioTurnRequest = z.strictObject({
  messages: z.array(StudioMessage).min(1).max(STUDIO_MAX_MESSAGES),
  clientTools: z.array(StudioClientToolDefinition).max(STUDIO_MAX_CLIENT_TOOLS).default([]),
});
export type StudioTurnRequest = z.infer<typeof StudioTurnRequest>;

/** A server tool call made during the turn, returned for transparency. */
export const StudioServerToolTrace = z.object({
  name: StudioServerTool,
  input: z.record(z.string(), z.unknown()),
  /** Short description of what the tool returned. */
  resultSummary: z.string(),
});
export type StudioServerToolTrace = z.infer<typeof StudioServerToolTrace>;

export const StudioTurnResponse = z.object({
  message: z.object({
    role: z.literal('assistant'),
    content: z.string(),
    /** Client tool calls for the browser to execute, then send back as `tool` messages. */
    toolCalls: z.array(StudioToolCall),
  }),
  serverToolCalls: z.array(StudioServerToolTrace),
  /** True when the model finished without needing client tool results. */
  done: z.boolean(),
});
export type StudioTurnResponse = z.infer<typeof StudioTurnResponse>;
