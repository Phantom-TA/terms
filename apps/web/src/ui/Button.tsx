import clsx from 'clsx';
import { Loader2 } from 'lucide-react';
import { type ComponentPropsWithRef, type ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks clicks while the server is working. */
  loading?: boolean;
  icon?: ReactNode;
}

const VARIANTS: Readonly<Record<ButtonVariant, string>> = {
  primary: 'bg-ink text-on-ink hover:bg-ink-2',
  secondary: 'border border-rule-strong bg-surface text-ink hover:bg-sunken',
  ghost: 'text-ink-2 hover:bg-sunken hover:text-ink',
  danger: 'border border-danger bg-surface text-danger hover:bg-danger-soft',
};

const SIZES: Readonly<Record<ButtonSize, string>> = {
  sm: 'h-7 gap-1.5 px-2.5 text-sm',
  md: 'h-9 gap-2 px-3.5 text-base',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap',
        'transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {loading ? <Loader2 aria-hidden className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}
