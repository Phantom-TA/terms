/** Maps database rows to the shared wire views used by several routes. */
import {
  type BusinessRef,
  type BusinessSummary,
  bpsToPercent,
  type ClientPolicyView,
  type SupplierPolicyView,
} from '@terms/shared';
import { type DbOrTx } from '../db.js';
import {
  type Business,
  type ClientPolicy,
  type SupplierPolicy,
} from '../generated/prisma/client.js';
import { money } from '../mappers.js';

export function businessSummary(b: Business): BusinessSummary {
  return {
    id: b.id,
    name: b.name,
    slug: b.slug,
    role: b.role,
    hasAgent: b.hasAgent,
    paypalEmail: b.paypalEmail,
    isDemo: b.isDemo,
  };
}

export function businessRef(b: Pick<Business, 'id' | 'name' | 'slug' | 'hasAgent'>): BusinessRef {
  return { id: b.id, name: b.name, slug: b.slug, hasAgent: b.hasAgent };
}

/** References for a list of business ids, in the list's order; unknown ids are skipped. */
export async function businessRefs(db: DbOrTx, ids: readonly string[]): Promise<BusinessRef[]> {
  if (ids.length === 0) return [];
  const rows = await db.business.findMany({ where: { id: { in: [...ids] } } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const b = byId.get(id);
    return b === undefined ? [] : [businessRef(b)];
  });
}

export async function supplierPolicyView(
  db: DbOrTx,
  p: SupplierPolicy,
): Promise<SupplierPolicyView> {
  return {
    maxDiscountPct: bpsToPercent(p.maxDiscountBps),
    openingDiscountPct: p.openingDiscountBps === null ? null : bpsToPercent(p.openingDiscountBps),
    doNotContact: await businessRefs(db, p.doNotContact),
    bufferPct: bpsToPercent(p.bufferBps),
    costCeiling: money(p.costCeilingCents),
    tone: p.tone,
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function clientPolicyView(db: DbOrTx, p: ClientPolicy): Promise<ClientPolicyView> {
  return {
    hurdleRatePct: bpsToPercent(p.hurdleBps),
    targetRatePct: bpsToPercent(p.targetBps),
    cashBuffer: money(p.cashBufferCents),
    autoPayLimit: money(p.autoPayLimitCents),
    earlyPayCapPerDeal: p.earlyPayCapCents === null ? null : money(p.earlyPayCapCents),
    neverPayEarly: await businessRefs(db, p.neverPayEarly),
    updatedAt: p.updatedAt.toISOString(),
  };
}
