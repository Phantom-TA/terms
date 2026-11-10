import { endpoints, STUDIO_MAX_MESSAGES, StudioTurnRequest } from '@terms/shared';
import {
  type AgAiAgentRunContext,
  type AgAiEvent,
  type AgAiMessage,
  type AgAiRunInput,
} from 'ag-studio';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/errors';
import { server } from '../../mocks/server';
import { installMockApi } from '../../test/msw';
import {
  responseEvents,
  runTurn,
  toClientTools,
  toStudioMessages,
  turnErrorMessage,
} from './turnBridge';

installMockApi();

const user = (content: string, id = 'u'): AgAiMessage => ({ id, role: 'user', content });

function input(messages: AgAiMessage[]): AgAiRunInput {
  return {
    threadId: 't',
    runId: 'r',
    messages,
    tools: [
      {
        name: 'add_widget',
        description: 'Add a widget.',
        parameters: { type: 'object', properties: {} },
      },
      { name: 'web_search', description: 'Hosted.', parameters: {}, kind: 'provided' },
    ],
    state: {},
    context: [],
    forwardedProps: {},
  };
}

const context = (signal?: AbortSignal): AgAiAgentRunContext => ({
  params: undefined,
  instructions: () => undefined,
  tools: () => [],
  ...(signal ? { signal } : {}),
});

async function collect(stream: AsyncIterable<AgAiEvent>): Promise<AgAiEvent[]> {
  const events: AgAiEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('the conversation sent to the server', () => {
  it('sends what was said and the widget calls, never Studio’s own prompt', () => {
    const messages = toStudioMessages([
      { id: 's', role: 'system', content: 'You are Studio.' },
      user('Cap discounts at 1%?'),
      {
        id: 'a',
        role: 'assistant',
        content: 'Charting it.',
        toolCalls: [
          { id: 'c1', type: 'function', function: { name: 'add_widget', arguments: '{"x":1}' } },
        ],
      },
      { id: 't', role: 'tool', toolCallId: 'c1', content: '{"success":true}' },
      { id: 't2', role: 'tool', toolCallId: 'c2', content: 'oops', error: 'No such widget' },
    ]);
    expect(messages).toEqual([
      { role: 'user', content: 'Cap discounts at 1%?' },
      {
        role: 'assistant',
        content: 'Charting it.',
        toolCalls: [{ id: 'c1', name: 'add_widget', input: { x: 1 } }],
      },
      { role: 'tool', toolCallId: 'c1', output: { success: true }, isError: false },
      { role: 'tool', toolCallId: 'c2', output: 'No such widget', isError: true },
    ]);
    expect(() => StudioTurnRequest.parse({ messages })).not.toThrow();
  });

  it('keeps the newest messages within the limit, starting where the owner spoke', () => {
    const long: AgAiMessage[] = [];
    for (let i = 0; i < STUDIO_MAX_MESSAGES; i += 1) {
      long.push(user(`q${i.toString()}`, `u${i.toString()}`), {
        id: `a${i.toString()}`,
        role: 'assistant',
        content: 'ok',
      });
    }
    const messages = toStudioMessages(long);
    expect(messages.length).toBeLessThanOrEqual(STUDIO_MAX_MESSAGES);
    expect(messages[0]?.role).toBe('user');
    expect(messages.at(-1)).toEqual({ role: 'assistant', content: 'ok', toolCalls: [] });
  });

  it('leaves out empty messages and arguments that are not an object', () => {
    expect(
      toStudioMessages([
        user('   '),
        user('Hi'),
        {
          id: 'a',
          role: 'assistant',
          toolCalls: [{ id: 'c', type: 'function', function: { name: 'x', arguments: '[1' } }],
        },
      ]),
    ).toEqual([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c', name: 'x', input: {} }] },
    ]);
  });

  it('offers the server only the tools the browser runs', () => {
    expect(toClientTools(input([]).tools)).toEqual([
      {
        name: 'add_widget',
        description: 'Add a widget.',
        inputSchema: { type: 'object', properties: {} },
      },
    ]);
  });
  it('keeps a long description whole, in the input schema, within the contract’s limit', () => {
    const long = 'Run a query. '.repeat(120);
    const [tool] = toClientTools([
      { name: 'execute_query', description: long, parameters: { type: 'object' } },
    ]);
    expect(tool!.description.length).toBeLessThanOrEqual(1000);
    expect(tool!.description).toMatch(/full description is in the input schema/);
    expect(tool!.inputSchema).toEqual({ type: 'object', description: long });
    expect(() =>
      StudioTurnRequest.parse({ messages: [{ role: 'user', content: 'Hi' }], clientTools: [tool] }),
    ).not.toThrow();
  });
});

describe('the server’s answer, as Studio’s events', () => {
  it('shows what the server read, then its words, then the widget calls', () => {
    let n = 0;
    const events = responseEvents(
      {
        message: {
          role: 'assistant',
          content: 'Here it is.',
          toolCalls: [{ id: 'c1', name: 'add_widget', input: { widgetId: 'w' } }],
        },
        serverToolCalls: [{ name: 'get_cash_runway', input: {}, resultSummary: '30 days' }],
        done: false,
      },
      () => `m${(n += 1).toString()}`,
    );
    expect(events.map((e) => e.type)).toEqual([
      'REASONING_MESSAGE_START',
      'REASONING_MESSAGE_CONTENT',
      'REASONING_MESSAGE_END',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
      'TOOL_CALL_START',
      'TOOL_CALL_ARGS',
      'TOOL_CALL_END',
    ]);
    expect(events[1]).toMatchObject({ delta: 'get_cash_runway: 30 days' });
    expect(events[7]).toEqual({
      type: 'TOOL_CALL_ARGS',
      toolCallId: 'c1',
      delta: '{"widgetId":"w"}',
    });
  });

  it('sends no empty message when the server only asks for widget calls', () => {
    const events = responseEvents({
      message: { role: 'assistant', content: '', toolCalls: [] },
      serverToolCalls: [],
      done: true,
    });
    expect(events).toEqual([]);
  });
});

describe('one round with the server', () => {
  it('posts a valid turn and returns the answer as events', async () => {
    let body: unknown;
    server.use(
      http.post(endpoints.studioTurn.path, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          message: { role: 'assistant', content: 'Hello.', toolCalls: [] },
          serverToolCalls: [],
          done: true,
        });
      }),
    );
    const events = await collect(runTurn(input([user('Hi')]), context()));
    expect(StudioTurnRequest.parse(body).clientTools.map((t) => t.name)).toEqual(['add_widget']);
    expect(events.find((e) => e.type === 'TEXT_MESSAGE_CONTENT')).toMatchObject({
      delta: 'Hello.',
    });
  });

  it('says plainly when the strategist is not available', async () => {
    server.use(
      http.post(endpoints.studioTurn.path, () =>
        HttpResponse.json(
          {
            error: {
              code: 'NOT_CONFIGURED',
              message: 'The Cash Studio agent is not available yet',
              retryable: false,
            },
          },
          { status: 503 },
        ),
      ),
    );
    const events = await collect(runTurn(input([user('Hi')]), context()));
    expect(events).toEqual([
      {
        type: 'RUN_ERROR',
        code: 'NOT_CONFIGURED',
        message:
          'The cash strategist isn’t available yet. The Cash Studio agent is not available yet',
      },
    ]);
  });

  it('ends quietly when the owner stops the run', async () => {
    const stop = new AbortController();
    stop.abort();
    const events = await collect(runTurn(input([user('Hi')]), context(stop.signal)));
    expect(events).toEqual([]);
  });

  it('asks nothing when there is nothing to send', async () => {
    expect(await collect(runTurn(input([]), context()))).toEqual([]);
  });
});

describe('what the owner reads when a turn fails', () => {
  it('names a limit, a server error with its request, and anything else', () => {
    expect(
      turnErrorMessage(
        new ApiError({ kind: 'server', status: 429, code: 'RATE_LIMITED', message: 'x' }),
      ),
    ).toMatch(/Too many questions/);
    expect(
      turnErrorMessage(
        new ApiError({
          kind: 'server',
          status: 502,
          code: 'AI_ERROR',
          message: 'Bad output.',
          requestId: 'req-9',
        }),
      ),
    ).toBe('Bad output. (request req-9)');
    expect(turnErrorMessage(new Error('boom'))).toBe(
      'The cash strategist could not answer. Try again.',
    );
  });
});
