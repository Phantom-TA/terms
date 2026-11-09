/**
 * Inserts the CONTEXT.md demo scenario (businesses, policies, invoices) into the test database.
 * Dates are relative to `today` so tests never depend on the calendar.
 */
import { addDays, dollars } from '@terms/shared';
import { type Db } from '../../src/db.js';
import { isoToDate } from '../../src/mappers.js';

export const TODAY = '2026-11-09';
export const FRIDAY = '2026-11-13';

export interface ScenarioIds {
  maya: string;
  juniper: string;
  harbor: string;
  oak: string;
  pinecrest: string;
  birch: string;
  invoices: Record<'1038' | '1039' | '1041' | '1042' | '1043', string>;
}

export async function seedScenario(db: Db, today = TODAY): Promise<ScenarioIds> {
  const business = (name: string, slug: string, role: 'SUPPLIER' | 'CLIENT', hasAgent: boolean) =>
    db.business.create({ data: { name, slug, role, hasAgent, isDemo: true } });

  const maya = await business('Maya Studio', 'maya-studio', 'SUPPLIER', false);
  const juniper = await business('Juniper Labs', 'juniper-labs', 'CLIENT', true);
  const harbor = await business('Harbor & Co', 'harbor-co', 'CLIENT', true);
  const oak = await business('Oak Street Bakery', 'oak-street-bakery', 'CLIENT', false);
  const pinecrest = await business('Pinecrest Dental', 'pinecrest-dental', 'CLIENT', false);
  const birch = await business('Birch Legal', 'birch-legal', 'CLIENT', false);

  await db.supplierPolicy.create({
    data: {
      businessId: maya.id,
      maxDiscountBps: 120,
      doNotContact: [pinecrest.id, birch.id],
      bufferBps: 500,
      costCeilingCents: dollars(60),
    },
  });
  await db.clientPolicy.create({
    data: {
      businessId: juniper.id,
      hurdleBps: 1200,
      targetBps: 2000,
      cashBufferCents: dollars(20000),
      autoPayLimitCents: dollars(3000),
      earlyPayCapCents: null,
      neverPayEarly: [],
      cashOnHandCents: dollars(80000),
    },
  });
  await db.clientPolicy.create({
    data: {
      businessId: harbor.id,
      hurdleBps: 1500,
      targetBps: 2300,
      cashBufferCents: dollars(20000),
      autoPayLimitCents: dollars(2000),
      earlyPayCapCents: dollars(5000),
      neverPayEarly: [],
      cashOnHandCents: dollars(60000),
    },
  });

  const invoice = async (number: string, clientId: string, amount: number, dueIn: number) =>
    (
      await db.invoice.create({
        data: {
          paypalInvoiceId: `INV2-TEST-${number}`,
          supplierId: maya.id,
          clientId,
          number,
          amountCents: dollars(amount),
          amountDueCents: dollars(amount),
          dueDate: isoToDate(addDays(today, dueIn)),
          paypalStatus: dueIn < 0 ? 'UNPAID' : 'SENT',
          contactAllowed: ![pinecrest.id, birch.id].includes(clientId),
          isDemo: true,
        },
      })
    ).id;

  return {
    maya: maya.id,
    juniper: juniper.id,
    harbor: harbor.id,
    oak: oak.id,
    pinecrest: pinecrest.id,
    birch: birch.id,
    invoices: {
      '1041': await invoice('1041', juniper.id, 5000, 18),
      '1043': await invoice('1043', harbor.id, 7500, 24),
      '1038': await invoice('1038', oak.id, 1800, -6),
      '1039': await invoice('1039', pinecrest.id, 2000, 9),
      '1042': await invoice('1042', birch.id, 1200, 15),
    },
  };
}

/** A goal and a DRAFT plan with one NEGOTIATE item for Harbor, plus its SUGGESTED deal. */
export async function seedDeal(db: Db, ids: ScenarioIds) {
  const goal = await db.goal.create({
    data: {
      supplierId: ids.maya,
      rawText: 'I need $6,200 by Friday. Max 1.2%.',
      amountCents: dollars(6200),
      deadline: isoToDate(FRIDAY),
      maxDiscountBps: 120,
      openingDiscountBps: 80,
      doNotContactIds: [ids.pinecrest, ids.birch],
      bufferBps: 500,
    },
  });
  const plan = await db.plan.create({ data: { goalId: goal.id, costCeilingCents: dollars(60) } });
  const item = await db.planItem.create({
    data: {
      planId: plan.id,
      invoiceId: ids.invoices['1043'],
      action: 'NEGOTIATE',
      rank: 'PRIMARY',
      discountBps: 80,
      amountEarlyCents: dollars(1750),
      payBy: isoToDate(TODAY),
      costCents: dollars(14),
      committedIfAgreedCents: dollars(1736),
      reasonCode: 'PARTIAL_TO_FIT_GAP',
      reason: 'test',
    },
  });
  const deal = await db.deal.create({
    data: {
      planItemId: item.id,
      planId: plan.id,
      invoiceId: ids.invoices['1043'],
      clientId: ids.harbor,
      action: 'NEGOTIATE',
      paypalInvoiceId: 'INV2-TEST-1043',
      costCents: dollars(14),
      committedCents: dollars(1736),
    },
  });
  return { goal, plan, item, deal };
}
