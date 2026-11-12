import clsx from 'clsx';
import { X } from 'lucide-react';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toApiError } from '../api/errors';
import { CopyButton } from './CopyButton';

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastInput {
  tone: ToastTone;
  title: string;
  description?: string;
  /** PayPal debug ID, shown with a copy button. */
  debugId?: string | null;
}

interface ToastItem extends ToastInput {
  id: number;
}

interface ToastApi {
  /** Only call with `tone: 'success'` after the server has confirmed the action. */
  toast: (input: ToastInput) => void;
  toastError: (title: string, error: unknown) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export const TOAST_DURATION_MS = 6000;

const TONE_RULE: Readonly<Record<ToastTone, string>> = {
  info: 'border-l-info',
  success: 'border-l-ink',
  error: 'border-l-danger',
};

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  // Errors stay until dismissed, because they may carry a debug ID to copy.
  useEffect(() => {
    if (item.tone === 'error') return;
    const timer = setTimeout(() => {
      onDismiss(item.id);
    }, TOAST_DURATION_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [item.id, item.tone, onDismiss]);

  return (
    <div
      role={item.tone === 'error' ? 'alert' : 'status'}
      className={clsx(
        'animate-enter pointer-events-auto flex w-80 max-w-full items-start gap-2 rounded-md border border-l-4 border-rule bg-surface p-3 shadow-overlay',
        TONE_RULE[item.tone],
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-base font-medium text-ink">{item.title}</p>
        {item.description ? <p className="text-sm text-ink-2">{item.description}</p> : null}
        {item.debugId ? (
          <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-ink-2">
            PayPal debug ID <code className="font-mono break-all">{item.debugId}</code>
            <CopyButton value={item.debugId} label="Copy PayPal debug ID" />
          </p>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => {
          onDismiss(item.id);
        }}
        className="rounded-sm p-0.5 text-ink-3 hover:bg-sunken hover:text-ink"
      >
        <X aria-hidden className="size-3.5" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<readonly ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback((input: ToastInput) => {
    const id = nextId.current;
    nextId.current += 1;
    setItems((current) => [...current, { ...input, id }]);
  }, []);

  const value = useMemo<ToastApi>(
    () => ({
      toast,
      toastError: (title, error) => {
        const apiError = toApiError(error);
        toast({
          tone: 'error',
          title,
          description: apiError.message,
          debugId: apiError.paypalDebugId,
        });
      },
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="region"
        aria-label="Notifications"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex max-w-[calc(100vw-2rem)] flex-col gap-2"
      >
        {items.map((item) => (
          <Toast key={item.id} item={item} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider');
  return value;
}
