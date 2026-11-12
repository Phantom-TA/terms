import { formatMoney } from '@terms/shared';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../../ui/Button';
import { MOCK_PAYPAL_CHANNEL, type MockPaymentMessage } from './mockPayPalChannel';

/** Only in-app paths, so this page can't send anyone elsewhere. */
function safePath(value: string | null, fallback: string): string {
  return value?.startsWith('/') && !value.startsWith('//') ? value : fallback;
}

const NOTICE = 'Mock of PayPal’s pages, for development only. Nothing is sent to PayPal.';

/** Stands in for a PayPal invoice: paying it, in this tab, is confirmed to the app by "webhook". */
function InvoicePage({ dealId, amount }: { dealId: string; amount: string | null }) {
  const [paid, setPaid] = useState(false);
  const pay = () => {
    const message: MockPaymentMessage = { type: 'invoice.paid', dealId };
    const channel = new BroadcastChannel(MOCK_PAYPAL_CHANNEL);
    channel.postMessage(message);
    channel.close();
    setPaid(true);
  };
  return (
    <>
      <h1 className="text-xl">
        PayPal invoice{amount && /^\d+\.\d{2}$/.test(amount) ? `: ${formatMoney(amount)}` : ''}
      </h1>
      {paid ? (
        <p role="status" className="text-base text-ink">
          Paid. PayPal doesn’t send you back; you can close this tab. Terms updates when PayPal
          confirms.
        </p>
      ) : (
        <>
          <p className="text-base text-ink-2">
            On the real page a person at the client pays the invoice with PayPal.
          </p>
          <Button variant="primary" onClick={pay}>
            Pay with PayPal
          </Button>
        </>
      )}
    </>
  );
}

/**
 * Development only: stands in for PayPal's pages in mock mode, so the hand-offs to PayPal can be
 * tried without a sandbox. Vite leaves it out of production builds.
 */
export function Component() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const dealId = params.get('deal');
  const back = safePath(params.get('return'), '/');
  const cancel = safePath(params.get('cancel'), back);

  return (
    <div className="mx-auto max-w-lg space-y-4 p-6">
      <p className="rounded-md border border-warn bg-warn-soft px-3 py-2 text-sm text-warn">
        {NOTICE}
      </p>
      {params.get('kind') === 'invoice' && dealId ? (
        <InvoicePage dealId={dealId} amount={params.get('amount')} />
      ) : (
        <>
          <h1 className="text-xl">Save PayPal as a payment method</h1>
          <p className="text-base text-ink-2">
            On the real page a person at the client agrees to let its agent pay from this PayPal
            account.
          </p>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => void navigate(back)}>
              Approve
            </Button>
            <Button onClick={() => void navigate(cancel)}>Cancel</Button>
          </div>
        </>
      )}
    </div>
  );
}
