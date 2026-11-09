import { DealState } from '@terms/shared';
import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { describe, expect, it } from 'vitest';
import {
  AgentTag,
  BestEffortTag,
  DealStatePill,
  Money,
  MoneyWithDiscount,
  PolicyBadge,
  PolicyBadges,
  ProtectedTag,
} from './finance';

describe('DealStatePill', () => {
  it.each(DealState.options)('renders %s', (state) => {
    render(<DealStatePill state={state} />);
    expect(document.body.textContent).not.toBe('');
  });

  it('labels the owner-facing state in plain words', () => {
    render(<DealStatePill state="NEEDS_OWNER" />);
    expect(screen.getByText('Needs you')).toBeInTheDocument();
  });
});

describe('PolicyBadge', () => {
  it('tells a screen reader the result and the reason', () => {
    render(
      <PolicyBadge
        check={{
          rule: 'maxDiscount',
          result: 'blocked',
          detail: '1.50% is above the 1.20% maximum',
        }}
      />,
    );
    expect(document.body).toHaveTextContent('Blocked. 1.50% is above the 1.20% maximum');
    expect(screen.getByText('· blocked')).toBeInTheDocument();
  });

  it('keeps a passing check quiet', () => {
    render(<PolicyBadge check={{ rule: 'hurdleRate', result: 'pass', detail: 'Above hurdle' }} />);
    expect(screen.queryByText(/· /)).not.toBeInTheDocument();
  });
});

describe('Money', () => {
  it('shows the server value formatted, never a float', () => {
    render(<Money value="4960.00" />);
    expect(screen.getByText('$4,960.00')).toBeInTheDocument();
  });

  it('strikes through the original and gives both values to screen readers', () => {
    render(<MoneyWithDiscount original="5000.00" discounted="4960.00" />);
    const original = screen.getByText('$5,000.00');
    expect(original.tagName).toBe('S');
    expect(document.body).toHaveTextContent('Was $5,000.00');
    expect(document.body).toHaveTextContent('Now $4,960.00');
  });
});

describe('labels required by the guardrails', () => {
  it('marks reminders as not counted', () => {
    render(<BestEffortTag />);
    expect(screen.getByText('Best effort, not counted')).toBeInTheDocument();
  });

  it('marks do-not-contact clients', () => {
    render(<ProtectedTag />);
    expect(screen.getByText('Do not contact')).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <div>
        <DealStatePill state="AWAITING_PAYMENT" />
        <PolicyBadges
          checks={[
            { rule: 'maxDiscount', result: 'pass', detail: 'ok' },
            { rule: 'costCeiling', result: 'needs_approval', detail: '$1 over' },
          ]}
        />
        <MoneyWithDiscount original="5000.00" discounted="4960.00" committed />
        <BestEffortTag />
        <ProtectedTag />
        <AgentTag hasAgent />
        <AgentTag hasAgent={false} />
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
