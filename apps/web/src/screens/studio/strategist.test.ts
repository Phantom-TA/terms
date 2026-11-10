import { type AgAiStudioTools, type AgAiTool } from 'ag-studio';
import { describe, expect, it } from 'vitest';
import { CONFIGURABLE_WIDGETS, strategistTools } from './strategist';

/** A stand-in for Studio's tool builders that records which ones were asked for. */
function recordingStudio() {
  const asked: string[] = [];
  const studio = new Proxy(
    {},
    {
      get:
        (_target, method: string) =>
        (first?: { widgetType?: string }, second?: { name?: string }) => {
          asked.push(method);
          return { name: second?.name ?? first?.widgetType ?? method } as unknown as AgAiTool;
        },
    },
  ) as AgAiStudioTools;
  return { studio, asked };
}

describe('the cash strategist’s tools', () => {
  it('can read, add, place and configure widgets, and nothing else', () => {
    const { studio, asked } = recordingStudio();
    strategistTools(studio);
    expect(new Set(asked)).toEqual(
      new Set([
        'viewSchema',
        'viewPage',
        'viewWidget',
        'executeQuery',
        'addWidget',
        'positionWidget',
        'configureWidget',
      ]),
    );
    for (const forbidden of [
      'removeWidget',
      'createExpression',
      'updateExpression',
      'deleteExpression',
      'addPageFilter',
      'removePageFilter',
      'addWidgetFilter',
      'removeWidgetFilter',
    ]) {
      expect(asked).not.toContain(forbidden);
    }
  });

  it('gives each configure tool its own name, so the model can tell them apart', () => {
    const { studio } = recordingStudio();
    const names = strategistTools(studio).map((t) => (t as unknown as { name: string }).name);
    expect(names).toEqual(expect.arrayContaining(Object.values(CONFIGURABLE_WIDGETS)));
    expect(new Set(names).size).toBe(names.length);
  });
});
