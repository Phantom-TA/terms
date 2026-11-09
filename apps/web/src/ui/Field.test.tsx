import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { describe, expect, it } from 'vitest';
import { Field, Input, Select, Textarea } from './Field';

describe('Field', () => {
  it('links the label and hint to the control', () => {
    render(
      <Field label="Cost ceiling" hint="In dollars">
        {(p) => <Input {...p} />}
      </Field>,
    );
    const input = screen.getByLabelText('Cost ceiling');
    expect(input).toHaveAccessibleDescription('In dollars');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('marks the control invalid and describes the error', () => {
    render(
      <Field label="Discount" hint="Up to your maximum" error="1.5% is above your 1.2% maximum">
        {(p) => <Input {...p} />}
      </Field>,
    );
    const input = screen.getByLabelText('Discount');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Up to your maximum 1.5% is above your 1.2% maximum');
  });

  it('has no accessibility violations for each control', async () => {
    const { container } = render(
      <div>
        <Field label="Name">{(p) => <Input {...p} />}</Field>
        <Field label="Reply" error="Required">
          {(p) => <Textarea {...p} />}
        </Field>
        <Field label="Action">
          {(p) => (
            <Select {...p}>
              <option>Reminder</option>
            </Select>
          )}
        </Field>
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
