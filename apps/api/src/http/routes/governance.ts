/** Approvals, standing policies and the audit trail. */
import { type ApprovalView, endpoints, percentToBps, toCents } from '@terms/shared';
import { type Router } from 'express';
import { toApprovalView } from '../../approvals/approval-service.js';
import { AppError, notFound } from '../../errors.js';
import { type Approval } from '../../generated/prisma/client.js';
import { type Services } from '../../services.js';
import { route } from '../route.js';
import { clientPolicyView, supplierPolicyView } from '../views.js';

export function registerGovernanceRoutes(router: Router, s: Services): void {
  const publishApproval = async (approval: Approval, view: ApprovalView) => {
    const audience = [approval.businessId, ...(await s.approvals.visibleTo(s.db, approval))];
    await s.events.publish(audience, { type: 'approval.decided', data: { approval: view } });
  };

  route(router, s.sessions, endpoints.listApprovals, async ({ query, session }) => ({
    approvals: await s.approvals.list(s.db, session.businessId, query),
  }));

  route(router, s.sessions, endpoints.decideApproval, async ({ params, body, session }) => {
    const approvalId = params['approvalId'] ?? '';
    const decided = await s.approvals.decide({
      approvalId,
      businessId: session.businessId,
      decision: body.decision,
      note: body.note,
      actor: session.business.role === 'SUPPLIER' ? 'OWNER' : 'CLIENT_HUMAN',
    });
    const view = toApprovalView(decided);
    await publishApproval(decided, view);
    // A person approves in Terms; the client's agent then pays from its saved method.
    return { approval: view, paypalApprovalUrl: null };
  });

  // ------------------------------------------------------------- supplier policy

  route(router, s.sessions, endpoints.getSupplierPolicy, async ({ session }) => {
    const policy = await s.db.supplierPolicy.findUnique({
      where: { businessId: session.businessId },
    });
    if (policy === null) throw notFound('Supplier policy');
    return { policy: await supplierPolicyView(s.db, policy) };
  });

  route(router, s.sessions, endpoints.putSupplierPolicy, async ({ body, session }) => {
    const ids = [...new Set(body.doNotContactIds)];
    const known = await s.db.business.count({ where: { id: { in: ids }, role: 'CLIENT' } });
    if (known !== ids.length) {
      throw new AppError('VALIDATION_FAILED', 'Do-not-contact must list client businesses', {
        issues: [{ path: 'doNotContactIds', message: 'Unknown client' }],
      });
    }
    const data = {
      maxDiscountBps: percentToBps(body.maxDiscountPct),
      openingDiscountBps:
        body.openingDiscountPct === null ? null : percentToBps(body.openingDiscountPct),
      doNotContact: ids,
      bufferBps: percentToBps(body.bufferPct),
      costCeilingCents: toCents(body.costCeiling),
      tone: body.tone,
    };
    const policy = await s.db.supplierPolicy.upsert({
      where: { businessId: session.businessId },
      create: { businessId: session.businessId, ...data },
      update: data,
    });
    await s.audit.write(s.db, {
      actor: 'OWNER',
      action: 'SUPPLIER_POLICY_UPDATED',
      subjectType: 'POLICY',
      subjectId: session.businessId,
      businessIds: [session.businessId],
      summary: `Policy saved: max ${body.maxDiscountPct}%, ceiling $${body.costCeiling}, ${String(ids.length)} protected clients`,
      details: { ...body },
    });
    return { policy: await supplierPolicyView(s.db, policy) };
  });

  // ------------------------------------------------------------- client policy

  route(router, s.sessions, endpoints.getClientPolicy, async ({ session }) => {
    const policy = await s.db.clientPolicy.findUnique({
      where: { businessId: session.businessId },
    });
    if (policy === null) throw notFound('Client policy');
    return { policy: await clientPolicyView(s.db, policy) };
  });

  route(router, s.sessions, endpoints.putClientPolicy, async ({ body, session }) => {
    const ids = [...new Set(body.neverPayEarlyIds)];
    const known = await s.db.business.count({ where: { id: { in: ids }, role: 'SUPPLIER' } });
    if (known !== ids.length) {
      throw new AppError('VALIDATION_FAILED', 'Never-pay-early must list supplier businesses', {
        issues: [{ path: 'neverPayEarlyIds', message: 'Unknown supplier' }],
      });
    }
    const data = {
      hurdleBps: percentToBps(body.hurdleRatePct),
      targetBps: percentToBps(body.targetRatePct),
      cashBufferCents: toCents(body.cashBuffer),
      autoPayLimitCents: toCents(body.autoPayLimit),
      earlyPayCapCents: body.earlyPayCapPerDeal === null ? null : toCents(body.earlyPayCapPerDeal),
      neverPayEarly: ids,
    };
    const policy = await s.db.clientPolicy.upsert({
      where: { businessId: session.businessId },
      // The declared cash figure (D-013) is kept; a new policy starts at zero until declared.
      create: { businessId: session.businessId, cashOnHandCents: 0n, ...data },
      update: data,
    });
    await s.audit.write(s.db, {
      actor: 'CLIENT_HUMAN',
      action: 'CLIENT_POLICY_UPDATED',
      subjectType: 'POLICY',
      subjectId: session.businessId,
      businessIds: [session.businessId],
      summary: `Agent policy saved: hurdle ${body.hurdleRatePct}%, auto-pay limit $${body.autoPayLimit}`,
      details: { ...body },
    });
    return { policy: await clientPolicyView(s.db, policy) };
  });

  // ------------------------------------------------------------- audit trail

  route(router, s.sessions, endpoints.listAudit, ({ query, session }) =>
    s.audit.list(s.db, session.businessId, query),
  );
}
