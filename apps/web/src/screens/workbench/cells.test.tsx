import { type PolicyCheckView } from '@terms/shared';
import { render, screen } from '@testing-library/react';
import { type CustomCellRendererProps } from 'ag-grid-react';
import { describe, expect, it } from 'vitest';
import { PolicyCell } from './cells';
import { type AnyRow, type WorkbenchRow } from './rows';

function renderPolicy(policyChecks: PolicyCheckView[]) {
  const data = { kind: 'invoice', policyChecks } as unknown as WorkbenchRow;
  const props = { data } as unknown as CustomCellRendererProps<AnyRow>;
  return render(<PolicyCell {...props} />);
}

const pass = (rule: PolicyCheckView['rule']): PolicyCheckView => ({
  rule,
  result: 'pass',
  detail: 'ok',
});

describe('PolicyCell', () => {
  it('stays blank when the server ran no checks', () => {
    const { container } = renderPolicy([]);
    expect(container).toBeEmptyDOMElement();
  });

  it('counts passing checks instead of listing them', () => {
    renderPolicy([pass('maxDiscount'), pass('doNotContact')]);
    expect(screen.getByText('All 2 passed')).toBeInTheDocument();
    expect(screen.queryByText('Max discount')).not.toBeInTheDocument();
  });

  it('names what needs attention', () => {
    renderPolicy([
      pass('maxDiscount'),
      { rule: 'costCeiling', result: 'needs_approval', detail: '$1 over' },
    ]);
    expect(screen.getByText('Cost ceiling')).toBeInTheDocument();
    expect(screen.getByText('· needs approval')).toBeInTheDocument();
    expect(screen.getByText('1 passed')).toBeInTheDocument();
  });

  it('shows a blocked check', () => {
    renderPolicy([{ rule: 'doNotContact', result: 'blocked', detail: 'Protected' }]);
    expect(screen.getByText('· blocked')).toBeInTheDocument();
    expect(screen.queryByText(/passed/)).not.toBeInTheDocument();
  });
});
