import { type RunwayResponse } from '@terms/shared';
import { AgCharts } from 'ag-charts-react';
import { useId, useMemo } from 'react';
import '../../charts/setup';
import { buildRunwayOptions, describeRunway } from './runwayOptions';

/**
 * The runway as an AG Chart. A canvas can't be read aloud, so the figures are also written out for
 * screen readers. The wrapper is a group, not an image, because the chart has focusable controls.
 */
export function RunwayChart({ runway }: { runway: RunwayResponse }) {
  const descriptionId = useId();
  const options = useMemo(
    () => buildRunwayOptions(runway, { strictValidation: import.meta.env.DEV }),
    [runway],
  );
  return (
    <div
      role="group"
      aria-label="Cash runway chart"
      aria-describedby={descriptionId}
      data-testid="runway-chart"
      className="h-64 w-full"
    >
      <p id={descriptionId} className="sr-only">
        {describeRunway(runway)}
      </p>
      <AgCharts options={options} />
    </div>
  );
}
