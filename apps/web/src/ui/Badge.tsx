import clsx from 'clsx';
import { type ReactNode } from 'react';
import { type Tone } from '../lib/display';

const TONES: Readonly<Record<Tone, string>> = {
  neutral: 'bg-neutral-soft text-neutral',
  info: 'bg-info-soft text-info',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  committed: 'bg-committed-soft text-committed-strong',
  'committed-solid': 'bg-committed text-on-ink',
  protected: 'bg-protected-soft text-protected',
};

const DOTS: Readonly<Record<Tone, string>> = {
  neutral: 'bg-neutral',
  info: 'bg-info',
  warn: 'bg-warn',
  danger: 'bg-danger',
  committed: 'bg-committed',
  'committed-solid': 'bg-on-ink',
  protected: 'bg-protected',
};

export interface BadgeProps {
  tone?: Tone;
  icon?: ReactNode;
  /** Shows a small dot; `pulse` animates it to say "still waiting". */
  dot?: boolean;
  pulse?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}

export function Badge({
  tone = 'neutral',
  icon,
  dot = false,
  pulse = false,
  title,
  className,
  children,
}: BadgeProps) {
  return (
    <span
      title={title}
      className={clsx(
        'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 align-middle text-xs font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {dot ? (
        <span
          aria-hidden
          className={clsx('size-1.5 rounded-full', DOTS[tone], pulse && 'animate-pulse-soft')}
        />
      ) : null}
      {icon}
      {children}
    </span>
  );
}
