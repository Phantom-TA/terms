import { type BusinessSummary } from '@terms/shared';
import { type ChangeEvent, useId } from 'react';
import { useNavigate } from 'react-router-dom';
import { Select } from '../ui/Field';
import { Skeleton } from '../ui/Skeleton';
import { useToast } from '../ui/Toast';
import { useBusinesses, useSession, useSwitchSession } from './session';

const NO_SESSION = '';

function Options({ label, items }: { label: string; items: readonly BusinessSummary[] }) {
  if (items.length === 0) return null;
  return (
    <optgroup label={label}>
      {items.map((business) => (
        <option key={business.id} value={business.id}>
          {business.name}
        </option>
      ))}
    </optgroup>
  );
}

/** Lets a demo visitor act as the owner or any client. */
export function SessionSwitcher() {
  const id = useId();
  const session = useSession();
  const businesses = useBusinesses();
  const switchSession = useSwitchSession();
  const navigate = useNavigate();
  const { toastError } = useToast();

  if (businesses.isPending || session.isPending) {
    return <Skeleton className="h-9 w-44" />;
  }
  // The page body shows the error and a retry, so there's nothing useful to show here.
  if (businesses.isError) return null;

  const owners = businesses.data.filter((b) => b.role === 'SUPPLIER');
  const clients = businesses.data.filter((b) => b.role === 'CLIENT');
  const currentId = session.data?.business.id ?? NO_SESSION;

  const onChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const businessId = event.target.value;
    if (businessId === NO_SESSION || businessId === currentId) return;
    switchSession.mutate(businessId, {
      onSuccess: () => void navigate('/'),
      onError: (error) => {
        toastError('Could not switch business', error);
      },
    });
  };

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm whitespace-nowrap text-ink-3">
        Acting as
      </label>
      <Select
        id={id}
        value={currentId}
        onChange={onChange}
        disabled={switchSession.isPending}
        className="w-44"
      >
        {currentId === NO_SESSION ? (
          <option value={NO_SESSION} disabled>
            Choose a business
          </option>
        ) : null}
        <Options label="Owner" items={owners} />
        <Options label="Clients" items={clients} />
      </Select>
    </div>
  );
}
