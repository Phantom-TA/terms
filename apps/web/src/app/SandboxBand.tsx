import { useHealth, useSession } from './session';

/** Always visible on sandbox and demo data, so nobody mistakes these figures for real money. */
export function SandboxBand() {
  const session = useSession();
  const health = useHealth();
  const environment = session.data?.paypalEnvironment ?? health.data?.paypalEnvironment;
  const demo = session.data?.demo ?? false;

  if (environment !== 'sandbox' && !demo) return null;

  return (
    <div
      role="note"
      aria-label="Environment"
      className="flex flex-wrap items-center justify-center gap-x-3 bg-ink px-4 py-1 text-xs text-on-ink"
    >
      <span className="font-medium tracking-widest uppercase">
        {environment === 'sandbox' ? 'PayPal sandbox' : 'Demo'}
        {environment === 'sandbox' && demo ? ' · Demo data' : ''}
      </span>
      <span>No real money moves. Every invoice and payment is a sandbox object.</span>
    </div>
  );
}
