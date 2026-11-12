import { type AgDefaultRegistry, type AgDefaultWidgetDefinition } from 'ag-studio';
import { createWidgets } from 'ag-studio-react';
import { costCurveDefinition } from './CostCurveWidget';

/** Studio's own widgets plus the plan's cost-versus-cash curve. */
export interface TermsRegistry extends Omit<AgDefaultRegistry, 'widgets'> {
  widgets: readonly (AgDefaultWidgetDefinition | typeof costCurveDefinition)[];
}

export const termsWidgets = createWidgets<TermsRegistry>({
  additionalTypes: [costCurveDefinition],
});
