import { type ActionType } from '@terms/shared';
import { type CustomCellEditorProps } from 'ag-grid-react';
import { useEffect, useState } from 'react';
import { ACTION_LABEL } from '../../lib/display';
import { type AnyRow, isInvoiceRow } from './rows';
import { allowedActions } from './validateEdit';

/**
 * The action picker. A native select, so it is keyboard and screen-reader friendly, listing only
 * the actions this client can be given (negotiation needs a client that runs an agent).
 */
export function ActionEditor({
  value,
  onValueChange,
  stopEditing,
  data,
}: CustomCellEditorProps<AnyRow, ActionType>) {
  const [picked, setPicked] = useState<ActionType | null>(null);
  const options = isInvoiceRow(data) ? allowedActions(data) : [];

  // Stop editing only once the grid has taken the new value, so the choice isn't lost.
  useEffect(() => {
    if (picked !== null && value === picked) stopEditing();
  }, [picked, value, stopEditing]);

  return (
    <select
      // Focus moves here because the owner just opened this cell to change it.
      // eslint-disable-next-line jsx-a11y/no-autofocus
      autoFocus
      aria-label="Action"
      value={value ?? 'NONE'}
      className="h-8 w-full rounded-sm border border-focus bg-surface px-1 text-base text-ink"
      onChange={(event) => {
        const next = event.target.value as ActionType;
        setPicked(next);
        onValueChange(next);
      }}
      onBlur={() => {
        if (picked === null) stopEditing(true);
      }}
    >
      {options.map((action) => (
        <option key={action} value={action}>
          {ACTION_LABEL[action]}
        </option>
      ))}
    </select>
  );
}
