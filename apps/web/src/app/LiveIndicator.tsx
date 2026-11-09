import clsx from 'clsx';
import { type StreamStatus } from '../api/stream';
import { useStreamStatus } from '../api/StreamProvider';

const DISPLAY: Readonly<Record<StreamStatus, { label: string; dot: string } | null>> = {
  open: { label: 'Live', dot: 'bg-info' },
  connecting: { label: 'Connecting…', dot: 'bg-warn animate-pulse-soft' },
  reconnecting: { label: 'Reconnecting…', dot: 'bg-warn animate-pulse-soft' },
  closed: null,
};

/** Says whether figures on screen are still updating. */
export function LiveIndicator() {
  const display = DISPLAY[useStreamStatus()];
  if (!display) return null;
  return (
    <span role="status" className="inline-flex items-center gap-1.5 text-sm text-ink-2">
      <span aria-hidden className={clsx('size-1.5 rounded-full', display.dot)} />
      {display.label}
    </span>
  );
}
