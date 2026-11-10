import { describe, expect, it } from 'vitest';
import {
  acceptableNote,
  AiNoteWriter,
  noteFactsText,
  noteSystem,
  WRITER_MAX_LENGTH,
} from '../../src/ai/note-role.js';
import { AiRoleError } from '../../src/ai/runner.js';
import { type NoteFacts } from '../../src/negotiation/engine.js';
import { answering, ScriptedRunner } from '../helpers/ai.js';

const offer: NoteFacts = {
  type: 'OFFER',
  from: 'supplier',
  senderName: 'Maya Studio',
  recipientName: 'Harbor & Co',
  invoiceNumber: '1043',
  round: 1,
  terms: {
    amountEarly: '1750.00',
    discountPct: '0.80',
    payBy: '2026-11-09',
    remainderDue: '2026-12-04',
  },
  payNow: '1736.00',
  tone: 'FRIENDLY_BRIEF',
};

describe('acceptableNote', () => {
  it('keeps a plain note, tidied', () => {
    expect(
      acceptableNote(
        '  Hi Harbor,\n we can offer 0.8% off $1,750 on invoice 1043 if paid today. ',
        offer,
      ),
    ).toBe('Hi Harbor, we can offer 0.8% off $1,750 on invoice 1043 if paid today.');
    expect(acceptableNote('Pay $1,736.00 now.', offer)).toBe('Pay $1,736.00 now.');
    expect(acceptableNote('Thank you!', offer)).toBe('Thank you!');
  });

  it('refuses a figure the facts do not contain', () => {
    expect(acceptableNote('We can give you 5% off.', offer)).toBeNull();
    expect(acceptableNote('Pay $1,700 now.', offer)).toBeNull();
    expect(acceptableNote('That saves you $500 a year.', offer)).toBeNull();
  });

  it('refuses anything that gives away policy, or is not plain text', () => {
    for (const text of [
      'This is as far as our policy lets us go.',
      'We are over our ceiling.',
      'Pay here: https://example.com/pay',
      'Pay **now**.',
      '<b>Pay now</b>',
      '',
      '   ',
      'x'.repeat(WRITER_MAX_LENGTH + 1),
    ]) {
      expect(acceptableNote(text, offer), text).toBeNull();
    }
  });
});

describe('what the writer is told', () => {
  it('is the public facts and the tone, and no reasons', () => {
    const text = noteFactsText(offer);
    expect(text).toContain('Maya Studio proposes paying part or all of an invoice early');
    expect(text).toContain(
      'Terms: pay $1,750.00 by 2026-11-09 at 0.80% off, which comes to $1,736.00.',
    );
    expect(text).toContain('The rest of the invoice stays due 2026-12-04.');
    expect(noteSystem(offer)).toContain('friendly and brief');
    expect(noteSystem({ ...offer, tone: 'FORMAL' })).toContain('formal and businesslike');
    expect(noteSystem({ ...offer, tone: 'WARM_DETAILED' })).toContain('warm and a little detailed');
    expect(noteSystem(offer)).toMatch(
      /never mention policies, limits, targets, budgets or reasons/,
    );

    const decline = noteFactsText({ ...offer, type: 'DECLINE', terms: null, payNow: null });
    expect(decline).toContain('give no reason');
    expect(decline).not.toContain('Terms:');
  });
});

describe('AiNoteWriter', () => {
  it('asks the fast model for the message writer role', async () => {
    const runner = answering('message-writer', { note: 'Happy to offer 0.8% off $1,750 today.' });
    const note = await new AiNoteWriter(runner).write(offer);
    expect(note).toBe('Happy to offer 0.8% off $1,750 today.');
    expect(runner.calls[0]).toMatchObject({ role: 'message-writer', tier: 'fast' });
  });

  it('returns null, and says why, when the note is unacceptable or the model fails', async () => {
    const why: string[] = [];
    const bad = new AiNoteWriter(
      answering('message-writer', { note: 'A 9% discount, wow.' }),
      (r) => why.push(r),
    );
    expect(await bad.write(offer)).toBeNull();
    for (const kind of ['provider', 'timeout', 'invalid'] as const) {
      const failing = new AiNoteWriter(
        new ScriptedRunner((c) => new AiRoleError(kind, c.role, 'x')),
        (r) => why.push(r),
      );
      expect(await failing.write(offer)).toBeNull();
    }
    expect(why).toEqual(['rejected', 'provider', 'timeout', 'invalid']);
  });

  it('does not hide a bug that is not the model’s', async () => {
    const writer = new AiNoteWriter(new ScriptedRunner(() => new Error('boom')));
    await expect(writer.write(offer)).rejects.toThrow('boom');
  });
});
