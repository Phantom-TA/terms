/** The CONTEXT.md demo as an approved plan, for tests that run negotiations on a real database. */
import { dollars } from '@terms/shared';
import { type Db } from '../../src/db.js';
import { isoToDate } from '../../src/mappers.js';
import { type PlanService } from '../../src/plans/plan-service.js';
import { FRIDAY, type ScenarioIds } from './fixtures.js';

/** Goal, plan and approval with Maya's $60 ceiling. Returns the deal ids by client. */
export async function approvedDemoPlan(db: Db, ids: ScenarioIds, plans: PlanService) {
  const goal = await db.goal.create({
    data: {
      supplierId: ids.maya,
      rawText:
        "I need $6,200 by Friday. Don't offer more than 1.2%, and don't contact Pinecrest or Birch.",
      amountCents: dollars(6200),
      deadline: isoToDate(FRIDAY),
      maxDiscountBps: 120,
      openingDiscountBps: 80,
      doNotContactIds: [ids.pinecrest, ids.birch],
      bufferBps: 500,
    },
  });
  const planId = await plans.createPlan(goal.id);
  await plans.approve(planId, ids.maya, dollars(60));
  const rows = await db.deal.findMany({ where: { planId }, include: { invoice: true } });
  const byNumber = Object.fromEntries(rows.map((d) => [d.invoice.number, d.id]));
  const dealFor = (number: string): string => {
    const id = byNumber[number];
    if (id === undefined) throw new Error(`the demo plan has no deal for invoice ${number}`);
    return id;
  };
  return { planId, juniper: dealFor('1041'), harbor: dealFor('1043'), oak: dealFor('1038') };
}
