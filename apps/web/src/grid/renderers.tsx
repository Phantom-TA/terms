import { type ActionType, type DealState } from '@terms/shared';
import { type CustomCellRendererProps } from 'ag-grid-react';
import {
  ActionTag,
  Money,
  MoneyWithDiscount,
  type PolicyCheckLike,
  PolicyBadges,
} from '../ui/finance';
import { DealStatePill } from '../ui/finance';

/** Grid adapters for the design-system components. They hold no logic of their own. */

export function DealStateCell({ value }: CustomCellRendererProps<unknown, DealState | null>) {
  return value ? <DealStatePill state={value} /> : null;
}

export function ActionCell({ value }: CustomCellRendererProps<unknown, ActionType | null>) {
  return value ? <ActionTag action={value} /> : null;
}

export function MoneyCell({ value }: CustomCellRendererProps<unknown, string | null>) {
  return value ? <Money value={value} /> : null;
}

export function CommittedMoneyCell({ value }: CustomCellRendererProps<unknown, string | null>) {
  return value ? <Money value={value} committed /> : null;
}

export interface DiscountedValue {
  original: string;
  discounted: string;
}

/** Money with the discount struck through. A row without a discount shows the plain amount. */
export function DiscountedMoneyCell({
  value,
}: CustomCellRendererProps<unknown, DiscountedValue | string | null>) {
  if (!value) return null;
  if (typeof value === 'string') return <Money value={value} />;
  return <MoneyWithDiscount original={value.original} discounted={value.discounted} />;
}

export function PolicyBadgesCell({
  value,
}: CustomCellRendererProps<unknown, readonly PolicyCheckLike[] | null>) {
  return value && value.length > 0 ? <PolicyBadges checks={value} /> : null;
}
