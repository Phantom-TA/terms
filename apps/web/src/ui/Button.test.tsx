import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('fires onClick and defaults to type=button so it never submits a form', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Approve plan</Button>);
    const button = screen.getByRole('button', { name: 'Approve plan' });
    expect(button).toHaveAttribute('type', 'button');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('blocks clicks and announces busy while loading', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Approve plan
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Approve plan' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <div>
        <Button variant="primary">Primary</Button>
        <Button variant="danger" size="sm">
          Reject
        </Button>
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
