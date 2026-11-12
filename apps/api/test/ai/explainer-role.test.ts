import { type PlanItemView } from '@terms/shared';
import { describe, expect, it } from 'vitest';
import {
  acceptableExplanation,
  AiPlanExplainer,
  EXPLANATION_MAX_LENGTH,
  explainerFacts,
  explainerSystem,
} from '../../src/ai/explainer-role.js';
import { AiRoleError } from '../../src/ai/runner.js';
import { answering, ScriptedRunner } from '../helpers/ai.js';

const item: PlanItemView = {
  id: 'item-1',
  planId: 'plan-1',
  invoiceId: 'inv-1',
  invoiceNumber: '1043',
  client: { id: 'c-1', name: 'Harbor & Co', slug: 'harbor-co', hasAgent: true },
  action: 'NEGOTIATE',
  rank: 'PRIMARY',
  backupOrder: null,
  discountPct: '0.80',
  amountEarly: '1750.00',
  payBy: '2026-11-09',
  daysEarly: 25,
  impliedAnnualRate: '12.3',
  cost: '14.00',
  committedIfAgreed: '1736.00',
  countsTowardGoal: true,
  reasonCode: 'CHEAPEST_COVER',
  reason: 'Cheapest cover for the gap.',
  explanation: null,
  editedByOwner: false,
  policyChecks: [
    { rule: 'maxDiscount', result: 'pass', detail: '0.80% is within your 1.20% maximum' },
  ],
  dealId: null,
  dealState: null,
};
const context = { gap: '6200.00', deadline: '2026-11-13' };

describe('explainerFacts', () => {
  it('states the row as the planner made it', () => {
    const text = explainerFacts(item, context);
    expect(text).toContain('Goal: raise $6,200.00 by 2026-11-13.');
    expect(text).toContain('Invoice 1043 to Harbor & Co.');
    expect(text).toContain('Planned action: NEGOTIATE.');
    expect(text).toContain("The planner's reason: Cheapest cover for the gap.");
    expect(text).toContain('Offer: pay $1,750.00 by 2026-11-09 at 0.80% off.');
    expect(text).toContain('It costs $14.00 and commits $1,736.00 if agreed.');
    expect(text).toContain('That is 25 days early, 12.3% a year.');
    expect(text).toContain('Policy check maxDiscount: pass. 0.80% is within your 1.20% maximum');
    expect(text).not.toContain('edited');
  });

  it('says when a row is a backup, an edit, or has no offer', () => {
    const backup = explainerFacts(
      { ...item, rank: 'BACKUP', backupOrder: 2, editedByOwner: true },
      context,
    );
    expect(backup).toContain('NEGOTIATE (backup number 2)');
    expect(backup).toContain('The owner edited this row.');
    const none = explainerFacts(
      {
        ...item,
        action: 'NONE',
        discountPct: null,
        amountEarly: null,
        payBy: null,
        policyChecks: [],
      },
      context,
    );
    expect(none).not.toContain('Offer:');
    expect(explainerSystem()).toMatch(/never state a number that is not in them/i);
  });
});

describe('acceptableExplanation', () => {
  const facts = explainerFacts(item, context);

  it('keeps a plain explanation made of the row’s own figures, tidied', () => {
    expect(
      acceptableExplanation(
        '  Harbor & Co is offered 0.8% off\n$1,750.00 to be paid by 2026-11-09: the cheapest cover. ',
        facts,
      ),
    ).toBe(
      'Harbor & Co is offered 0.8% off $1,750.00 to be paid by 2026-11-09: the cheapest cover.',
    );
  });

  it('refuses invented figures, markup, lists, links and long text', () => {
    for (const text of [
      'This saves you $500 a year.',
      'A 3% discount is fair.',
      '**Cheapest** cover.',
      '- Cheapest cover',
      'See https://example.com',
      '',
      'x'.repeat(EXPLANATION_MAX_LENGTH + 1),
    ]) {
      expect(acceptableExplanation(text, facts), text).toBeNull();
    }
  });
});

describe('AiPlanExplainer', () => {
  it('asks the fast model for the plan explainer role', async () => {
    const runner = answering('plan-explainer', {
      explanation: 'The cheapest way to cover the gap.',
    });
    expect(await new AiPlanExplainer(runner).explain(item, context)).toBe(
      'The cheapest way to cover the gap.',
    );
    expect(runner.calls[0]).toMatchObject({ role: 'plan-explainer', tier: 'fast' });
  });

  it('returns null, and says why, when the answer is refused or the model fails', async () => {
    const why: string[] = [];
    const bad = new AiPlanExplainer(
      answering('plan-explainer', { explanation: 'A 4% discount.' }),
      (w) => why.push(w),
    );
    expect(await bad.explain(item, context)).toBeNull();
    const down = new AiPlanExplainer(
      new ScriptedRunner((c) => new AiRoleError('timeout', c.role, 'slow')),
      (w) => why.push(w),
    );
    expect(await down.explain(item, context)).toBeNull();
    expect(why).toEqual(['rejected', 'timeout']);
    await expect(
      new AiPlanExplainer(new ScriptedRunner(() => new Error('boom'))).explain(item, context),
    ).rejects.toThrow('boom');
  });
});
