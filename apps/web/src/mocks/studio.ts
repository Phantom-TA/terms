import {
  type StudioServerToolTrace,
  type StudioToolCall,
  type StudioTurnRequest,
  type StudioTurnResponse,
} from '@terms/shared';

/**
 * A scripted stand-in for the cash strategist's model, for dev-only mock mode and tests. Like the
 * server, it calls only the client tools the browser offered, and it answers from a short script
 * for each kind of question rather than from a model. It never invents figures for a what-if: it
 * charts the owner's own runway and says which server tool would answer.
 */

interface Step {
  /** Words for the owner on this round, if any. */
  say: string;
  /** Widget calls for the browser to run on this round. */
  calls: Omit<StudioToolCall, 'id'>[];
  server?: StudioServerToolTrace[];
}

function lineChart(widgetId: string, title: string, server: StudioServerToolTrace[] = []): Step[] {
  return [
    {
      server,
      say: 'I’ll chart your runway: before the plan, with cash already committed, and if every offer is accepted.',
      calls: [
        {
          name: 'add_widget',
          input: { widgetId, type: 'line-chart', xTrack: 0, yTrack: 0, xSpan: 12, ySpan: 8 },
        },
      ],
    },
    {
      say: '',
      calls: [
        {
          name: 'configure_line_chart',
          input: {
            op: 'patch',
            widgetId,
            value: {
              type: 'line-chart',
              format: { title: { enabled: true, text: title } },
              dataMapping: {
                categoryKey: [{ id: 'runway.date::day' }],
                valueKey: [
                  { id: 'runway.before', aggregation: 'sum' },
                  { id: 'runway.afterCommitted', aggregation: 'sum' },
                  { id: 'runway.afterPlanned', aggregation: 'sum' },
                ],
              },
            },
          },
        },
      ],
    },
  ];
}

function columnChart(widgetId: string): Step[] {
  return [
    {
      say: 'Here is what each client owes you.',
      calls: [
        {
          name: 'add_widget',
          input: {
            widgetId,
            type: 'column-chart-grouped',
            xTrack: 0,
            yTrack: 0,
            xSpan: 12,
            ySpan: 8,
          },
        },
      ],
    },
    {
      say: '',
      calls: [
        {
          name: 'configure_column_chart',
          input: {
            op: 'patch',
            widgetId,
            value: {
              type: 'column-chart-grouped',
              format: { title: { enabled: true, text: 'What each client owes' } },
              dataMapping: {
                categoryKey: [{ id: 'invoices.client' }],
                valueKey: [{ id: 'invoices.amountDue', aggregation: 'sum' }],
              },
              sort: [
                { field: { id: 'invoices.amountDue', aggregation: 'sum' }, direction: 'desc' },
              ],
            },
          },
        },
      ],
    },
  ];
}

function costCurve(widgetId: string): Step[] {
  return [
    {
      say: 'Here is what each extra dollar of early cash costs you, cheapest first.',
      calls: [
        {
          name: 'add_widget',
          input: { widgetId, type: 'cost-cash-curve', xTrack: 0, yTrack: 0, xSpan: 12, ySpan: 8 },
        },
      ],
    },
    {
      say: '',
      calls: [
        {
          name: 'configure_cost_curve',
          input: {
            op: 'patch',
            widgetId,
            value: {
              type: 'cost-cash-curve',
              format: { title: { enabled: true, text: 'What early cash costs' } },
              dataMapping: {
                label: [{ id: 'invoices.client' }],
                cost: [{ id: 'invoices.planCost', aggregation: 'sum' }],
                cash: [{ id: 'invoices.planCash', aggregation: 'sum' }],
              },
            },
          },
        },
      ],
    },
  ];
}

function script(question: string, run: number): { steps: Step[]; closing: string } {
  const widgetId = `strategist-${run.toString()}`;
  const q = question.toLowerCase();
  if (/\bcap\b|discounts? at/.test(q)) {
    const steps = lineChart(widgetId, 'Cash runway, with your plan', [
      {
        name: 'simulate_discount_cap',
        input: { capPct: '1.00' },
        resultSummary: 'Mock mode: the server runs this what-if; nothing is simulated here.',
      },
    ]);
    return {
      steps,
      closing:
        'In mock mode I can’t run the what-if itself; the server does that. The chart shows your runway with today’s plan, to compare against.',
    };
  }
  if (/\bcost\b|curve|cheapest/.test(q))
    return { steps: costCurve(widgetId), closing: 'Each point adds one plan row.' };
  if (q.includes('owe')) return { steps: columnChart(widgetId), closing: 'Largest first.' };
  if (/runway|before and after|cash/.test(q))
    return {
      steps: lineChart(widgetId, 'Cash runway, before and after the plan'),
      closing: 'Done.',
    };
  return {
    steps: [],
    closing:
      'I can chart your runway, what clients owe, or a what-if on your discount limit. Try one of the suggestions.',
  };
}

/** One turn: the round is how many tool results have come back since the owner last spoke. */
export function mockStudioTurn(request: StudioTurnRequest): StudioTurnResponse {
  const { messages, clientTools } = request;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const question = messages[lastUser];
  const asked = question?.role === 'user' ? question.content : '';
  const runs = messages.filter((m) => m.role === 'user').length;
  const round = messages.slice(lastUser + 1).filter((m) => m.role === 'assistant').length;
  const { steps, closing } = script(asked, runs);
  const offered = new Set(clientTools.map((t) => t.name));
  const step = steps[round];

  if (!step || step.calls.some((call) => !offered.has(call.name))) {
    return {
      message: { role: 'assistant', content: closing, toolCalls: [] },
      serverToolCalls: [],
      done: true,
    };
  }
  return {
    message: {
      role: 'assistant',
      content: step.say,
      toolCalls: step.calls.map((call, index) => ({
        ...call,
        id: `call_${runs.toString()}_${round.toString()}_${index.toString()}`,
      })),
    },
    serverToolCalls: step.server ?? [],
    done: false,
  };
}
