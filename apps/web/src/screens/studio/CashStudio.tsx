import { type AgPageLayoutState, type AgPanelConfig, AgStudioAiModule } from 'ag-studio';
import { AgStudio, AgStudioProvider } from 'ag-studio-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorState } from '../../ui/ErrorState';
import { SkeletonRows } from '../../ui/Skeleton';
import { useInvoices, useRunway } from '../workbench/queries';
import { strategist } from './strategist';
import { studioSources } from './studioData';
import { termsStudioTheme } from './theme';

const licenseKey = import.meta.env.VITE_AG_STUDIO_LICENSE_KEY;
const modules = [AgStudioAiModule];
/**
 * Only the conversation, beside the widgets: the strategist does the composing and reads the data
 * itself. Studio's data panel is left out: it covered the widgets on a tablet, and its table
 * headers nest a menu button inside a button, which screen readers can't operate.
 */
const panels: AgPanelConfig = { edit: { left: ['ai'], right: [] } };
/** A 12-column page, so a full-width widget (xSpan 12) fills the canvas, narrow enough for a tablet. */
const layout: Partial<AgPageLayoutState> = { columns: 12, rowHeight: 40, minWidth: 360 };

export function Component() {
  const invoices = useInvoices();
  const runway = useRunway();
  // Built once per change of the server's data: Studio treats a new object as new sources.
  const data = useMemo(
    () => (invoices.data ? studioSources(invoices.data, runway.data ?? null) : null),
    [invoices.data, runway.data],
  );

  let body;
  if (invoices.isPending) {
    body = <SkeletonRows rows={6} columns={3} label="Loading your cash data" />;
  } else if (!data) {
    body = (
      <ErrorState
        title="Couldn’t load your cash data"
        error={invoices.error}
        onRetry={() => void invoices.refetch()}
        retrying={invoices.isFetching}
      />
    );
  } else if (data.sources.every((s) => !('data' in s) || s.data.length === 0)) {
    body = (
      <EmptyState
        title="No cash data yet"
        action={
          <Link className="text-base font-medium text-accent underline" to="/connect">
            Go to Connect &amp; import
          </Link>
        }
      >
        Import your invoices from PayPal first, then ask the strategist about them.
      </EmptyState>
    );
  } else {
    body = (
      <div className="h-[calc(100dvh-14rem)] min-h-[560px]" data-testid="cash-studio">
        <AgStudioProvider modules={modules} {...(licenseKey ? { licenseKey } : {})}>
          <AgStudio
            data={data}
            mode="edit"
            theme={termsStudioTheme}
            ai={strategist}
            panels={panels}
            layout={layout}
            style={{ height: '100%', width: '100%' }}
          />
        </AgStudioProvider>
      </div>
    );
  }

  return (
    <div className="space-y-4 px-4 py-4 lg:px-6">
      <header className="space-y-1">
        <h1 className="text-xl">Cash Studio</h1>
        <p className="text-base text-ink-2">
          Ask a what-if about your cash. The strategist reads your invoices and runway and builds
          the answer as widgets. It can’t change your data, your plan or PayPal.
        </p>
      </header>
      {body}
    </div>
  );
}
