import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../../ui/Button';

/** Only in-app paths, so this page can't send anyone elsewhere. */
function safePath(value: string | null, fallback: string): string {
  return value?.startsWith('/') && !value.startsWith('//') ? value : fallback;
}

/**
 * Development only: stands in for PayPal's approval page in mock mode, so the redirect to PayPal
 * and back can be tried without a sandbox. Vite leaves it out of production builds.
 */
export function Component() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const kind = params.get('kind') === 'payment' ? 'payment' : 'vault';
  const back = safePath(params.get('return'), '/');
  const cancel = safePath(params.get('cancel'), back);

  return (
    <div className="mx-auto max-w-lg space-y-4 p-6">
      <p className="rounded-md border border-warn bg-warn-soft px-3 py-2 text-sm text-warn">
        Mock of PayPal’s approval page, for development only. Nothing is sent to PayPal.
      </p>
      <h1 className="text-xl">
        {kind === 'payment' ? 'Approve this payment' : 'Save PayPal as a payment method'}
      </h1>
      <p className="text-base text-ink-2">
        {kind === 'payment'
          ? 'On the real page a person at the client approves the payment. Terms then waits for PayPal to confirm it.'
          : 'On the real page a person at the client agrees to let its agent pay from this PayPal account.'}
      </p>
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => void navigate(back)}>
          Approve
        </Button>
        <Button onClick={() => void navigate(cancel)}>Cancel</Button>
      </div>
    </div>
  );
}
