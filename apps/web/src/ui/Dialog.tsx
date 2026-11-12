import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { type ReactNode, useRef } from 'react';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  /** The dialog's buttons. */
  footer?: ReactNode;
}

export function Dialog({ open, onOpenChange, title, description, children, footer }: DialogProps) {
  // Radix only restores focus to its own Trigger. These dialogs are controlled, so remember
  // what had focus when the dialog opened and return there when it closes.
  const returnFocusTo = useRef<HTMLElement | null>(null);

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-ink/30" />
        <RadixDialog.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          onOpenAutoFocus={() => {
            returnFocusTo.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocusTo.current?.focus();
          }}
          className="animate-enter fixed top-1/2 left-1/2 z-50 max-h-[85dvh] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-rule bg-surface shadow-overlay"
        >
          <header className="flex items-start justify-between gap-4 px-5 pt-4">
            <div>
              <RadixDialog.Title className="font-display text-lg">{title}</RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-1 text-base text-ink-2">
                  {description}
                </RadixDialog.Description>
              ) : null}
            </div>
            <RadixDialog.Close
              aria-label="Close"
              className="rounded-sm p-1 text-ink-3 hover:bg-sunken hover:text-ink"
            >
              <X aria-hidden className="size-4" />
            </RadixDialog.Close>
          </header>
          {children ? <div className="px-5 py-3">{children}</div> : <div className="h-3" />}
          {footer ? (
            <footer className="flex justify-end gap-2 border-t border-rule px-5 py-3">
              {footer}
            </footer>
          ) : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
