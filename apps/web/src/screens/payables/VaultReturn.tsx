import { useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorState } from '../../ui/ErrorState';
import { PendingNotice } from '../../ui/PendingNotice';
import { useToast } from '../../ui/Toast';
import { useVaultConfirm } from './queries';

const LINK = 'font-medium text-ink underline underline-offset-2';

/** PayPal sends the person back here after they approve saving the method. */
export function Component() {
  const [params] = useSearchParams();
  const setupTokenId = params.get('approval_token_id') ?? params.get('token');
  const confirm = useVaultConfirm();
  const navigate = useNavigate();
  const { toast } = useToast();
  const started = useRef(false);

  const run = (id: string) => {
    confirm.mutate(id, {
      onSuccess: () => {
        toast({
          tone: 'success',
          title: 'PayPal method saved',
          description: 'Your agent can now pay within its limit.',
        });
        void navigate('/payables', { replace: true });
      },
    });
  };

  useEffect(() => {
    // Once, even in development's double effects: a second confirm would fail.
    if (started.current || setupTokenId === null) return;
    started.current = true;
    run(setupTokenId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once for the token PayPal returned
  }, [setupTokenId]);

  return (
    <div className="mx-auto max-w-2xl p-6">
      {setupTokenId === null ? (
        <EmptyState headingLevel="h1" title="Nothing to finish">
          <p>PayPal didn’t send back an approval with this page.</p>
          <Link to="/payables" className={LINK}>
            Back to the Payables Desk
          </Link>
        </EmptyState>
      ) : confirm.isError ? (
        <ErrorState
          headingLevel="h1"
          title="The method wasn’t saved"
          error={confirm.error}
          onRetry={() => {
            run(setupTokenId);
          }}
          retrying={confirm.isPending}
        />
      ) : (
        <>
          <h1 className="mb-4 text-xl">Saving your PayPal method</h1>
          <PendingNotice
            title="Waiting for PayPal confirmation"
            detail="Checking the approval you just gave on PayPal."
          />
        </>
      )}
    </div>
  );
}
