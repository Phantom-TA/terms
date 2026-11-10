import { type Actor, type AuditAction, type Tone as ToneOption } from '@terms/shared';

export const ACTOR_LABEL: Readonly<Record<Actor, string>> = {
  OWNER: 'Owner',
  SUPPLIER_AGENT: 'Supplier agent',
  CLIENT_AGENT: 'Client agent',
  CLIENT_HUMAN: 'Client (a person)',
  SYSTEM: 'Terms',
  PAYPAL: 'PayPal',
};

/** "DEAL_TRANSITION" → "Deal transition". */
export function actionLabel(action: AuditAction): string {
  const words = action.toLowerCase().replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const TONE_LABEL: Readonly<Record<ToneOption, string>> = {
  FRIENDLY_BRIEF: 'Friendly and brief',
  FORMAL: 'Formal',
  WARM_DETAILED: 'Warm and detailed',
};
