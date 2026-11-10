import { StudioTurnResponse, type StudioMessage } from '@terms/shared';
import { describe, expect, it } from 'vitest';
import { mockStudioTurn } from './studio';

const ALL_TOOLS = [
  'view_schema',
  'add_widget',
  'configure_line_chart',
  'configure_column_chart',
  'configure_value',
  'configure_cost_curve',
].map((name) => ({ name, description: name, inputSchema: { type: 'object' } }));

function turn(messages: StudioMessage[], tools = ALL_TOOLS) {
  return StudioTurnResponse.parse(mockStudioTurn({ messages, clientTools: tools }));
}

describe('the mock cash strategist', () => {
  it('adds a chart, then configures it once Studio says it was added, then finishes', () => {
    const ask: StudioMessage = { role: 'user', content: 'Show my cash runway' };
    const first = turn([ask]);
    expect(first.message.toolCalls.map((c) => c.name)).toEqual(['add_widget']);
    expect(first.done).toBe(false);

    const added: StudioMessage[] = [
      ask,
      { role: 'assistant', content: first.message.content, toolCalls: first.message.toolCalls },
      {
        role: 'tool',
        toolCallId: first.message.toolCalls[0]!.id,
        output: { success: true },
        isError: false,
      },
    ];
    const second = turn(added);
    expect(second.message.toolCalls[0]).toMatchObject({
      name: 'configure_line_chart',
      input: { widgetId: 'strategist-1', op: 'patch' },
    });

    const third = turn([
      ...added,
      { role: 'assistant', content: '', toolCalls: second.message.toolCalls },
      { role: 'tool', toolCallId: second.message.toolCalls[0]!.id, output: {}, isError: false },
    ]);
    expect(third.done).toBe(true);
    expect(third.message.toolCalls).toEqual([]);
  });

  it('says which server tool answers a what-if, and invents no figures', () => {
    const answer = turn([{ role: 'user', content: 'What if I cap discounts at 1.0%?' }]);
    expect(answer.serverToolCalls.map((c) => c.name)).toEqual(['simulate_discount_cap']);
    expect(JSON.stringify(answer)).not.toMatch(/\$\d/);
  });

  it('charts what clients owe, largest first', () => {
    const answer = turn([{ role: 'user', content: 'Who owes me most?' }]);
    expect(answer.message.toolCalls[0]?.input).toMatchObject({ type: 'column-chart-grouped' });
  });

  it('draws the plan’s cost-versus-cash curve with the custom widget', () => {
    const answer = turn([{ role: 'user', content: 'What does early cash cost me?' }]);
    expect(answer.message.toolCalls[0]?.input).toMatchObject({ type: 'cost-cash-curve' });
  });

  it('calls no tool the browser did not offer', () => {
    const answer = turn([{ role: 'user', content: 'Show my cash runway' }], []);
    expect(answer.message.toolCalls).toEqual([]);
    expect(answer.done).toBe(true);
  });

  it('says what it can do when it has no script for the question', () => {
    const answer = turn([{ role: 'user', content: 'Tell me a joke' }]);
    expect(answer.message.content).toMatch(/I can chart/);
    expect(answer.done).toBe(true);
  });
});
