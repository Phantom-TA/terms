import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { describe, expect, it, vi } from 'vitest';
import { Chip, EditableChip } from './Chip';

function setup(overrides: Partial<Parameters<typeof EditableChip>[0]> = {}) {
  const onCommit = vi.fn<(raw: string) => void | Promise<void>>();
  const { container } = render(
    <EditableChip
      label="Amount"
      display="$6,200.00"
      editValue="6200"
      onCommit={onCommit}
      {...overrides}
    />,
  );
  return { container, onCommit, user: userEvent.setup() };
}

const openEditor = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Edit Amount: $6,200.00' }));

describe('Chip', () => {
  it('shows a remove button only when removal is possible', async () => {
    const onRemove = vi.fn();
    const { rerender } = render(<Chip>Pinecrest Dental</Chip>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(
      <Chip onRemove={onRemove} removeLabel="Allow contact with Pinecrest Dental">
        Pinecrest Dental
      </Chip>,
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Allow contact with Pinecrest Dental' }),
    );
    expect(onRemove).toHaveBeenCalledOnce();
  });
});

describe('EditableChip', () => {
  it('saves on Enter and closes once the server accepts', async () => {
    const { onCommit, user } = setup();
    await openEditor(user);
    const input = screen.getByLabelText('Amount');
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.type(input, '6500{Enter}');
    expect(onCommit).toHaveBeenCalledWith('6500');
    await waitFor(() => {
      expect(screen.queryByLabelText('Amount')).not.toBeInTheDocument();
    });
  });

  it('saves when focus leaves the field', async () => {
    const { onCommit, user } = setup();
    await openEditor(user);
    await user.clear(screen.getByLabelText('Amount'));
    await user.type(screen.getByLabelText('Amount'), '7000');
    await user.tab();
    expect(onCommit).toHaveBeenCalledWith('7000');
  });

  it('does not save an unchanged value', async () => {
    const { onCommit, user } = setup();
    await openEditor(user);
    await user.keyboard('{Enter}');
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Edit Amount/ })).toBeInTheDocument();
  });

  it('cancels on Escape without saving', async () => {
    const { onCommit, user } = setup();
    await openEditor(user);
    await user.type(screen.getByLabelText('Amount'), '99{Escape}');
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Edit Amount/ })).toBeInTheDocument();
  });

  it('keeps the editor open and explains an invalid value', async () => {
    const { onCommit, user } = setup({ validate: () => 'Enter an amount like 6200' });
    await openEditor(user);
    await user.type(screen.getByLabelText('Amount'), 'abc{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter an amount like 6200');
    expect(screen.getByLabelText('Amount')).toHaveAttribute('aria-invalid', 'true');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('keeps the editor open when the server rejects the change', async () => {
    const onCommit = vi.fn().mockRejectedValue(new Error('Above your maximum'));
    const { user } = setup({ onCommit });
    await openEditor(user);
    await user.type(screen.getByLabelText('Amount'), '1{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Above your maximum');
    expect(screen.getByLabelText('Amount')).toBeInTheDocument();
  });

  it('cannot be edited when disabled', () => {
    setup({ disabled: true });
    expect(screen.getByRole('button', { name: /Edit Amount/ })).toBeDisabled();
  });

  it('has no accessibility violations while viewing or editing', async () => {
    const { container, user } = setup();
    expect(await axe(container)).toHaveNoViolations();
    await openEditor(user);
    expect(await axe(container)).toHaveNoViolations();
  });
});
