import { render, screen } from '@testing-library/react';
import { type ComponentType } from 'react';
import { describe, expect, it } from 'vitest';
import {
  ActionCell,
  CommittedMoneyCell,
  DealStateCell,
  DiscountedMoneyCell,
  MoneyCell,
  PolicyBadgesCell,
} from './renderers';

function renderCell(Cell: unknown, value: unknown) {
  const Rendered = Cell as ComponentType<{ value: unknown }>;
  return render(<Rendered value={value} />);
}

describe('grid cell renderers', () => {
  it('renders the deal-state pill', () => {
    renderCell(DealStateCell, 'AWAITING_PAYMENT');
    expect(screen.getByText('Awaiting payment')).toBeInTheDocument();
  });

  it('renders the action name', () => {
    renderCell(ActionCell, 'EARLY_DISCOUNT');
    expect(screen.getByText('Early-payment discount')).toBeInTheDocument();
  });

  it('renders server money', () => {
    renderCell(MoneyCell, '5000.00');
    expect(screen.getByText('$5,000.00')).toBeInTheDocument();
  });

  it('renders committed money in the accent', () => {
    renderCell(CommittedMoneyCell, '4960.00');
    expect(screen.getByText('$4,960.00')).toHaveClass('text-committed-strong');
  });

  it('strikes through the discounted amount', () => {
    renderCell(DiscountedMoneyCell, { original: '5000.00', discounted: '4960.00' });
    expect(screen.getByText('$5,000.00').tagName).toBe('S');
    expect(screen.getByText('$4,960.00')).toBeInTheDocument();
  });

  it('shows the plain amount when there is no discount', () => {
    renderCell(DiscountedMoneyCell, '1800.00');
    expect(screen.getByText('$1,800.00')).toBeInTheDocument();
  });

  it('renders policy badges', () => {
    renderCell(PolicyBadgesCell, [{ rule: 'maxDiscount', result: 'blocked', detail: 'Too high' }]);
    expect(screen.getByText('· blocked')).toBeInTheDocument();
  });

  it.each([
    ['deal state', DealStateCell],
    ['action', ActionCell],
    ['money', MoneyCell],
    ['discount', DiscountedMoneyCell],
    ['policy', PolicyBadgesCell],
  ] as const)('leaves an empty %s cell blank', (_name, Cell) => {
    const { container } = renderCell(Cell, null);
    expect(container).toBeEmptyDOMElement();
  });
});
