import { Link } from 'react-router-dom';
import { EmptyState } from '../../ui/EmptyState';

/** PayPal sends the person here if they cancel. Nothing was saved. */
export function Component() {
  return (
    <div className="mx-auto max-w-2xl p-6">
      <EmptyState headingLevel="h1" title="Nothing was saved">
        <p>You cancelled on PayPal, so no payment method was saved.</p>
        <Link to="/payables" className="font-medium text-ink underline underline-offset-2">
          Back to the Payables Desk
        </Link>
      </EmptyState>
    </div>
  );
}
