/**
 * The plan explainer role (CONTEXT.md, AI roles): one or two plain sentences on why the planner put
 * a row in the plan, shown on the Workbench row. The planner is deterministic code and has already
 * decided; the model only puts its decision into words.
 *
 * It is given the row as the planner produced it (figures, reason, the policy checks that ran) and
 * may state only figures those contain. A note that invents one, or is not plain text, is dropped,
 * and the row simply shows the planner's own reason instead.
 */
import { formatMoney, type PlanItemView } from '@terms/shared';
import { z } from 'zod';
import { type AiRunner, AiRoleError } from './runner.js';
import { unsupportedNumbers } from './safety.js';

export const EXPLANATION_MAX_LENGTH = 400;

export const ExplanationAnswer = z.object({
  explanation: z
    .string()
    .min(1)
    .max(EXPLANATION_MAX_LENGTH * 2)
    .describe('One or two plain sentences, no markdown, no line breaks.'),
});

export interface ExplainContext {
  /** The goal the plan serves. */
  gap: string;
  deadline: string;
}

export function explainerSystem(): string {
  return [
    'You explain, in one or two plain sentences, why a cash-planning tool put one invoice in the',
    "owner's plan the way it did. The tool has already decided; you only say why, to the owner.",
    'Use only the facts you are given. Never state a number that is not in them, never invent a',
    'reason, and never promise an outcome: a client may say no. Plain text, no markdown, no lists.',
    'If the row is a reminder, say it is a reminder and why. If nothing is done for the row, say why.',
    'If it is a backup, say it only runs if an earlier offer is declined.',
  ].join('\n');
}

/** The row as text: also the set of figures the explanation may state. */
export function explainerFacts(item: PlanItemView, context: ExplainContext): string {
  const lines = [
    `Goal: raise ${formatMoney(context.gap)} by ${context.deadline}.`,
    `Invoice ${item.invoiceNumber} to ${item.client.name}.`,
    `Planned action: ${item.action}${item.rank === 'BACKUP' ? ` (backup number ${String(item.backupOrder ?? 1)})` : ''}.`,
    `The planner's reason: ${item.reason}`,
  ];
  if (item.discountPct !== null && item.amountEarly !== null && item.payBy !== null) {
    lines.push(
      `Offer: pay ${formatMoney(item.amountEarly)} by ${item.payBy} at ${item.discountPct}% off.`,
      `It costs ${formatMoney(item.cost)} and commits ${formatMoney(item.committedIfAgreed)} if agreed.`,
    );
    if (item.daysEarly !== null && item.impliedAnnualRate !== null) {
      lines.push(
        `That is ${String(item.daysEarly)} days early, ${item.impliedAnnualRate}% a year.`,
      );
    }
  }
  if (item.editedByOwner) lines.push('The owner edited this row.');
  for (const check of item.policyChecks) {
    lines.push(`Policy check ${check.rule}: ${check.result}. ${check.detail}`);
  }
  return lines.join('\n');
}

/** The explanation, tidied, or null when it breaks a rule. Pure. */
export function acceptableExplanation(text: string, facts: string): string | null {
  const note = text.replace(/\s+/g, ' ').trim();
  if (note.length === 0 || note.length > EXPLANATION_MAX_LENGTH) return null;
  if (/https?:|www\.|[<>`*#]|^\s*[-•]/.test(note)) return null;
  if (unsupportedNumbers(note, [facts]).length > 0) return null;
  return note;
}

export class AiPlanExplainer {
  constructor(
    private readonly runner: AiRunner,
    private readonly onFallback: (why: string) => void = () => undefined,
  ) {}

  /** The row's explanation, or null to show the planner's reason alone. */
  async explain(item: PlanItemView, context: ExplainContext): Promise<string | null> {
    const facts = explainerFacts(item, context);
    try {
      const { explanation } = await this.runner.run({
        role: 'plan-explainer',
        tier: 'fast',
        system: explainerSystem(),
        prompt: facts,
        schema: ExplanationAnswer,
      });
      const accepted = acceptableExplanation(explanation, facts);
      if (accepted === null) this.onFallback('rejected');
      return accepted;
    } catch (err) {
      if (!(err instanceof AiRoleError)) throw err;
      this.onFallback(err.kind);
      return null;
    }
  }
}
