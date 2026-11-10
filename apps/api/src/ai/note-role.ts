/**
 * The message writer role (CONTEXT.md, AI roles): writes the short human-readable note on a
 * negotiation message, in the sender's tone.
 *
 * It is told only public facts about the message: the terms, the parties and the invoice. It is
 * never given a side's reasons, limits or policy checks, so it cannot reveal them (D-023). Even so,
 * its text is checked: it may not state a figure the facts do not contain, name a policy, or run
 * long. Anything that fails the check is discarded and the engine's plain note is used instead.
 */
import { formatMoney, NOTE_MAX_LENGTH } from '@terms/shared';
import { z } from 'zod';
import { type NoteFacts, type NoteWriter } from '../negotiation/engine.js';
import { AiRoleError, type AiRunner } from './runner.js';
import { revealsPolicy, unsupportedNumbers } from './safety.js';

/** Notes are one to three short sentences; the contract allows more, the writer does not. */
export const WRITER_MAX_LENGTH = 400;

export const NoteAnswer = z.object({
  note: z
    .string()
    .min(1)
    .max(WRITER_MAX_LENGTH * 2)
    .describe('The note, as plain text with no markdown and no line breaks.'),
});

const TONES: Record<NoteFacts['tone'], string> = {
  FRIENDLY_BRIEF: 'friendly and brief: one or two short sentences',
  FORMAL: 'formal and businesslike: two short sentences',
  WARM_DETAILED: 'warm and a little detailed: two or three short sentences',
};

const KINDS: Record<NoteFacts['type'], string> = {
  OFFER: 'proposes paying part or all of an invoice early for a discount',
  COUNTER: 'answers with different terms',
  ACCEPT: 'accepts the terms on the table',
  DECLINE: 'declines the offer; give no reason and do not discuss policy',
  WITHDRAW: 'withdraws the offer',
};

export function noteSystem(facts: NoteFacts): string {
  return [
    'You write the short note that goes with one message in an early-payment negotiation between',
    'two businesses about an invoice. The message already carries the terms in structured form;',
    'your note is the friendly sentence a person would write beside it.',
    `Tone: ${TONES[facts.tone]}.`,
    'Use only the facts you are given. Never state a number that is not in them, never promise or',
    'threaten anything, and never mention policies, limits, targets, budgets or reasons.',
    'Write plain text with no markdown, no greeting line and no sign-off.',
  ].join('\n');
}

/** The facts as text: also the set of figures the note may state. */
export function noteFactsText(facts: NoteFacts): string {
  const lines = [
    `${facts.senderName} ${KINDS[facts.type]} (message type ${facts.type}, round ${String(facts.round)}).`,
    `The message goes to ${facts.recipientName} about invoice ${facts.invoiceNumber}.`,
  ];
  if (facts.terms !== null) {
    lines.push(
      `Terms: pay ${formatMoney(facts.terms.amountEarly)} by ${facts.terms.payBy} at ${facts.terms.discountPct}% off, ` +
        `which comes to ${formatMoney(facts.payNow ?? facts.terms.amountEarly)}.`,
    );
    if (facts.terms.remainderDue !== null) {
      lines.push(`The rest of the invoice stays due ${facts.terms.remainderDue}.`);
    }
  }
  return lines.join('\n');
}

/** The note, tidied, or null when it breaks a rule. Pure. */
export function acceptableNote(text: string, facts: NoteFacts): string | null {
  const note = text.replace(/\s+/g, ' ').trim();
  if (note.length === 0 || note.length > WRITER_MAX_LENGTH || note.length > NOTE_MAX_LENGTH) {
    return null;
  }
  if (/https?:|www\.|[<>`*_#]/i.test(note)) return null;
  if (revealsPolicy(note)) return null;
  if (
    unsupportedNumbers(note, [noteFactsText(facts), facts.senderName, facts.recipientName]).length >
    0
  ) {
    return null;
  }
  return note;
}

export class AiNoteWriter implements NoteWriter {
  constructor(
    private readonly runner: AiRunner,
    private readonly onFallback: (reason: string) => void = () => undefined,
  ) {}

  async write(facts: NoteFacts): Promise<string | null> {
    try {
      const { note } = await this.runner.run({
        role: 'message-writer',
        tier: 'fast',
        system: noteSystem(facts),
        prompt: noteFactsText(facts),
        schema: NoteAnswer,
      });
      const accepted = acceptableNote(note, facts);
      if (accepted === null) this.onFallback('rejected');
      return accepted;
    } catch (err) {
      if (!(err instanceof AiRoleError)) throw err;
      this.onFallback(err.kind);
      return null;
    }
  }
}
