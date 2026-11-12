import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';

const COPIED_MS = 2000;

/** Says "Copied" only after the clipboard write succeeds. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (status === 'idle') return;
    const timer = setTimeout(() => {
      setStatus('idle');
    }, COPIED_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [status]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={label}
      className="inline-flex items-center gap-1 rounded-sm px-1 text-xs text-ink-3 hover:bg-sunken hover:text-ink"
    >
      {status === 'copied' ? (
        <Check aria-hidden className="size-3" />
      ) : (
        <Copy aria-hidden className="size-3" />
      )}
      <span aria-live="polite">
        {status === 'copied' ? 'Copied' : status === 'failed' ? 'Copy failed' : 'Copy'}
      </span>
    </button>
  );
}
