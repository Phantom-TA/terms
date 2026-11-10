import {
  type AgAiHarnessSetup,
  type AgAiPromptStarter,
  type AgAiStudioTools,
  type AgAiTool,
  type AgStudioApi,
  clientToolRunner,
  createAiHarness,
} from 'ag-studio';
import { runTurn } from './turnBridge';

/** The widget types the strategist may configure, by Studio's catalogue id, and its tool for each. */
export const CONFIGURABLE_WIDGETS = {
  'line-chart': 'configure_line_chart',
  'column-chart-grouped': 'configure_column_chart',
  value: 'configure_value',
} as const;

/**
 * The strategist's tools, and so the whole of what it can do. It reads the data and the page, and
 * adds, places and configures widgets. It has no tool to change the data model, filter the page,
 * delete a widget or reach anything outside Studio, so no answer from the model can do those.
 *
 * Studio offers a tool only while it can be called: until a widget exists, the configure tools and
 * `view_widget` are left out of the request. Each configure tool is renamed, since all three would
 * otherwise reach the model as `configure_widget`.
 */
export function strategistTools(studio: AgAiStudioTools): AgAiTool[] {
  return [
    studio.viewSchema(),
    studio.viewPage(),
    studio.viewWidget(),
    studio.executeQuery(),
    studio.addWidget(),
    studio.positionWidget(),
    ...Object.entries(CONFIGURABLE_WIDGETS).map(([widgetType, name]) =>
      studio.configureWidget({ widgetType }, { name }),
    ),
  ];
}

export const promptStarters: AgAiPromptStarter[] = [
  {
    label: 'Cap discounts at 1.0%',
    prompt: 'What if I cap discounts at 1.0% next month? Show me what it does to my cash.',
  },
  { label: 'Who owes me most', prompt: 'Chart what each client owes me, largest first.' },
  { label: 'Cash before and after', prompt: 'Show my cash runway before and after the plan.' },
];

/**
 * The cash strategist: one agent, whose model runs on the server behind `POST /api/studio/turn`.
 * Studio runs the loop and the widget tools in the page; the server holds the prompt and the
 * read-only cash tools.
 */
export const strategist: AgAiHarnessSetup = ({ api }) =>
  // AgAiHarnessSetupParams is typed with the UI-less core API, but in the browser Studio passes the
  // full AgStudioApi (AgStudioCommon narrows it), which is what createAiHarness needs.
  createAiHarness(api as AgStudioApi, ({ tools: { studio } }) => ({
    agents: [
      clientToolRunner({
        id: 'cash-strategist',
        name: 'Cash strategist',
        description: 'Answers what-if questions about cash and builds widgets to show the answer.',
        schema: (s) => s.undefined(),
        maxTurns: 12,
        tools: () => strategistTools(studio),
        run: runTurn,
      }),
    ],
    primary: 'cash-strategist',
    promptStarters,
  }));
