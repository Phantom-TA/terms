import {
  addDays,
  type ApprovalView,
  type AuditEntry,
  type BusinessRef,
  type BusinessSummary,
  checkAutoPayLimit,
  checkCashBuffer,
  checkEarlyPayCap,
  checkHurdleRate,
  checkNeverPayEarly,
  type ClientOffer,
  type ClientPolicyView,
  type ConnectionResponse,
  diffDays,
  discountOn,
  fromCents,
  impliedAnnualRate,
  isFinal,
  type ListAuditQuery,
  nextWeekday,
  type OfferReplyRequest,
  type OfferReplyResponse,
  type ParsedReply,
  percentToBps,
  type PolicyCheckView,
  type PublicOffer,
  type PutClientPolicyRequest,
  type PutSupplierPolicyRequest,
  type ServerEvent,
  type SupplierPolicyView,
  type SyncResponse,
  toCents,
  type VaultSetupResponse,
  type VaultView,
} from '@terms/shared';
import { BALANCE, clientRefs, type MockWorld, SUPPLIER_POLICY, TODAY } from './world';

/**
 * The client side and the settings screens of the demo, for dev-only mock mode and tests. It reads
 * the world's deals and approvals. Like the world, it never reports a payment: only PayPal can.
 */

export const MAYA: BusinessRef = {
  id: 'biz_maya',
  name: 'Maya Studio',
  slug: 'maya-studio',
  hasAgent: true,
};

const NOW = '2026-11-09T10:00:00Z';
const CLIENT_CASH = 50_000_00n;

export class TokenError extends Error {}
export class DeskValidationError extends Error {}

interface OfferRecord {
  offer: PublicOffer;
  replied: boolean;
}

function ref(id: string): BusinessRef {
  const found = [...clientRefs(), MAYA].find((r) => r.id === id);
  if (!found) throw new DeskValidationError(`Unknown business ${id}`);
  return found;
}

function demoOffer(state: PublicOffer['state']): PublicOffer {
  return {
    supplierName: 'Maya Studio',
    clientName: 'Oak Street Bakery',
    invoiceNumber: '1045',
    invoiceAmount: '5000.00',
    currency: 'USD',
    originalDueDate: addDays(TODAY, 18),
    terms: { amountEarly: '5000.00', discountPct: '1.00', payBy: TODAY, remainderDue: null },
    payNow: '4950.00',
    discountAmount: '50.00',
    impliedAnnualRate: impliedAnnualRate(100, 18),
    allowPartial: true,
    minPartial: '500.00',
    state,
    payUrl: null,
    expiresAt: '2026-11-12T18:00:00Z',
    note: 'Hi from Maya Studio. If paying early helps you too, here is 1% off invoice 1045.',
    demo: true,
  };
}

export class MockDesk {
  supplierPolicy: SupplierPolicyView;
  readonly clientPolicies = new Map<string, ClientPolicyView>();
  readonly vaults = new Map<string, VaultView & { setupTokenId: string | null }>();
  private lastSyncedAt: string | null = '2026-11-09T09:55:00Z';
  private readonly offers = new Map<string, OfferRecord>();

  constructor(private readonly world: () => MockWorld) {
    this.supplierPolicy = {
      ...SUPPLIER_POLICY,
      doNotContact: [ref('biz_pinecrest'), ref('biz_birch')],
    };
    this.clientPolicies.set('biz_juniper', {
      hurdleRatePct: '12.00',
      targetRatePct: '20.00',
      cashBuffer: '20000.00',
      autoPayLimit: '3000.00',
      earlyPayCapPerDeal: null,
      neverPayEarly: [],
      updatedAt: NOW,
    });
    this.clientPolicies.set('biz_harbor', {
      hurdleRatePct: '15.00',
      targetRatePct: '23.00',
      cashBuffer: '20000.00',
      autoPayLimit: '2000.00',
      earlyPayCapPerDeal: '5000.00',
      neverPayEarly: [],
      updatedAt: NOW,
    });
    this.vaults.set('biz_juniper', {
      status: 'NONE',
      paymentTokenId: null,
      payerEmail: null,
      updatedAt: null,
      setupTokenId: null,
    });
    this.vaults.set('biz_harbor', {
      status: 'ACTIVE',
      paymentTokenId: 'mock-token-harbor',
      payerEmail: 'harbor@business.example.com',
      updatedAt: NOW,
      setupTokenId: null,
    });
    this.offers.set('demo-oak', { offer: demoOffer('OPEN'), replied: false });
    this.offers.set('demo-expired', { offer: demoOffer('EXPIRED'), replied: false });
    this.offers.set('demo-used', { offer: demoOffer('ACCEPTED'), replied: true });
  }

  // ------------------------------------------------------------------ policies

  putSupplierPolicy(body: PutSupplierPolicyRequest): SupplierPolicyView {
    this.supplierPolicy = {
      maxDiscountPct: body.maxDiscountPct,
      openingDiscountPct: body.openingDiscountPct,
      doNotContact: body.doNotContactIds.map(ref),
      bufferPct: body.bufferPct,
      costCeiling: body.costCeiling,
      tone: body.tone,
      updatedAt: NOW,
    };
    this.world().log(
      'SUPPLIER_POLICY_UPDATED',
      'You changed your standing policy.',
      'OWNER',
      'POLICY',
      'biz_maya',
    );
    return this.supplierPolicy;
  }

  clientPolicy(clientId: string): ClientPolicyView {
    const policy = this.clientPolicies.get(clientId);
    if (!policy) throw new DeskValidationError('This client runs no agent.');
    return policy;
  }

  putClientPolicy(clientId: string, body: PutClientPolicyRequest): ClientPolicyView {
    this.clientPolicy(clientId);
    const policy: ClientPolicyView = {
      hurdleRatePct: body.hurdleRatePct,
      targetRatePct: body.targetRatePct,
      cashBuffer: body.cashBuffer,
      autoPayLimit: body.autoPayLimit,
      earlyPayCapPerDeal: body.earlyPayCapPerDeal,
      neverPayEarly: body.neverPayEarlyIds.map(ref),
      updatedAt: NOW,
    };
    this.clientPolicies.set(clientId, policy);
    this.world().log(
      'CLIENT_POLICY_UPDATED',
      'The client changed its agent’s policy.',
      'CLIENT_HUMAN',
      'POLICY',
      clientId,
    );
    return policy;
  }

  // ------------------------------------------------------------------ the Payables Desk

  private clientChecks(clientId: string, offer: ClientOffer): PolicyCheckView[] {
    const policy = this.clientPolicy(clientId);
    const early = toCents(offer.terms.amountEarly);
    const bps = percentToBps(offer.terms.discountPct);
    const payment = early - discountOn(early, bps);
    return [
      checkNeverPayEarly(
        offer.supplier.id,
        policy.neverPayEarly.map((b) => b.id),
      ),
      checkHurdleRate(bps, offer.daysEarly, percentToBps(policy.hurdleRatePct)),
      checkEarlyPayCap(
        early,
        policy.earlyPayCapPerDeal ? toCents(policy.earlyPayCapPerDeal) : null,
      ),
      checkCashBuffer(CLIENT_CASH, payment, toCents(policy.cashBuffer)),
      checkAutoPayLimit(payment, toCents(policy.autoPayLimit)),
    ];
  }

  clientOffers(clientId: string, status: 'OPEN' | 'CLOSED' | 'ALL'): ClientOffer[] {
    const world = this.world();
    const offers = [...world.deals.values()]
      .filter((d) => d.client.id === clientId && d.action !== 'REMINDER' && d.action !== 'NONE')
      .flatMap((deal) => {
        const terms = deal.agreedTerms ?? deal.currentTerms;
        if (!terms) return [];
        const row = world.invoiceRows().find((r) => r.id === deal.invoiceId);
        if (!row) return [];
        const early = toCents(terms.amountEarly);
        const bps = percentToBps(terms.discountPct);
        const daysEarly = Math.max(1, diffDays(row.dueDate, terms.payBy));
        const discount = discountOn(early, bps);
        const pending = [...world.approvals.values()].find(
          (a) => a.dealId === deal.id && a.type === 'CLIENT_PAYMENT' && a.decision === 'PENDING',
        );
        const offer: ClientOffer = {
          dealId: deal.id,
          supplier: MAYA,
          invoice: { id: row.id, number: row.number, amount: row.amount, dueDate: row.dueDate },
          state: deal.state,
          terms,
          payNow: fromCents(early - discount),
          discountAmount: fromCents(discount),
          daysEarly,
          impliedAnnualRate: impliedAnnualRate(bps, daysEarly),
          policyChecks: [],
          recommendation: 'ACCEPT',
          round: Math.max(1, deal.round),
          expiresAt: world.messages.get(deal.id)?.at(-1)?.expiresAt ?? null,
          pendingApprovalId: pending?.id ?? null,
          updatedAt: deal.updatedAt,
        };
        const checks = this.clientChecks(clientId, offer);
        const blocked = checks.filter((c) => c.result === 'blocked');
        offer.policyChecks = checks;
        offer.recommendation = blocked.some((c) => c.rule === 'hurdleRate')
          ? 'COUNTER'
          : blocked.length > 0
            ? 'DECLINE'
            : checks.some((c) => c.result === 'needs_approval')
              ? 'NEEDS_HUMAN'
              : 'ACCEPT';
        return [offer];
      })
      .filter((offer) => {
        if (status === 'ALL') return true;
        const closed = isFinal(offer.state);
        return status === 'CLOSED' ? closed : !closed;
      });
    return offers.sort((a, b) => Number(b.impliedAnnualRate) - Number(a.impliedAnnualRate));
  }

  cashPosition(clientId: string) {
    const buffer = toCents(this.clientPolicy(clientId).cashBuffer);
    return {
      available: fromCents(CLIENT_CASH),
      buffer: fromCents(buffer),
      spendableEarly: fromCents(CLIENT_CASH > buffer ? CLIENT_CASH - buffer : 0n),
      asOf: NOW,
    };
  }

  // ------------------------------------------------------------------ saved PayPal method

  vault(clientId: string): VaultView {
    const vault = this.vaults.get(clientId);
    if (!vault) throw new DeskValidationError('This client runs no agent.');
    const { setupTokenId: _setup, ...view } = vault;
    return view;
  }

  /** The approval link points at the dev-only stand-in for PayPal's page (see MockPayPal). */
  setupVault(clientId: string, origin: string): VaultSetupResponse {
    const vault = this.vaults.get(clientId);
    if (!vault) throw new DeskValidationError('This client runs no agent.');
    const setupTokenId = `mock-setup-${clientId.replace('biz_', '')}`;
    this.vaults.set(clientId, { ...vault, status: 'PENDING', setupTokenId, updatedAt: NOW });
    const back = `/client/vault/return?approval_token_id=${setupTokenId}`;
    const cancel = '/client/vault/cancel';
    this.world().log(
      'VAULT_SETUP_STARTED',
      'Saving a PayPal method was started.',
      'CLIENT_HUMAN',
      'VAULT_TOKEN',
      setupTokenId,
    );
    return {
      setupTokenId,
      approvalUrl: `${origin}/mock-paypal?kind=vault&return=${encodeURIComponent(back)}&cancel=${encodeURIComponent(cancel)}`,
    };
  }

  confirmVault(clientId: string, setupTokenId: string): VaultView {
    const vault = this.vaults.get(clientId);
    const slug = clientId.replace('biz_', '');
    // In the browser the mock starts afresh on every page load, and coming back from PayPal is a
    // page load, so the waiting state may be gone. The token is fixed per client, so accept it.
    const waiting =
      vault?.status === 'PENDING'
        ? vault.setupTokenId === setupTokenId
        : vault?.status !== 'ACTIVE' && setupTokenId === `mock-setup-${slug}`;
    if (!vault || !waiting) {
      throw new DeskValidationError('There is no PayPal approval waiting for this link.');
    }
    this.vaults.set(clientId, {
      status: 'ACTIVE',
      paymentTokenId: `mock-token-${slug}`,
      payerEmail: `${slug}@business.example.com`,
      updatedAt: NOW,
      setupTokenId: null,
    });
    this.world().log(
      'VAULT_TOKEN_CREATED',
      'PayPal saved the client’s payment method.',
      'PAYPAL',
      'VAULT_TOKEN',
      setupTokenId,
    );
    return this.vault(clientId);
  }

  // ------------------------------------------------------------------ approvals

  approvalsFor(business: BusinessSummary): ApprovalView[] {
    const world = this.world();
    return [...world.approvals.values()].filter((approval) => {
      if (business.role === 'SUPPLIER') return approval.requestedFrom === 'OWNER';
      if (approval.requestedFrom !== 'CLIENT_HUMAN') return false;
      return [...world.deals.values()].some(
        (d) => d.id === approval.dealId && d.client.id === business.id,
      );
    });
  }

  paymentApprovalUrl(origin: string): string {
    return `${origin}/mock-paypal?kind=payment&return=${encodeURIComponent('/approvals')}`;
  }

  // ------------------------------------------------------------------ audit

  /** Newest first, each business seeing what concerns it, a page at a time. */
  audit(
    business: BusinessSummary,
    query: ListAuditQuery,
  ): { entries: AuditEntry[]; nextCursor: string | null } {
    const world = this.world();
    const mine = new Set(
      [...world.deals.values()].filter((d) => d.client.id === business.id).map((d) => d.id),
    );
    const all = world.auditLog
      .filter((e) => business.role === 'SUPPLIER' || (e.dealId !== null && mine.has(e.dealId)))
      .filter((e) => !query.actor || e.actor === query.actor)
      .filter((e) => !query.action || e.action === query.action)
      .filter((e) => !query.dealId || e.dealId === query.dealId)
      .toReversed();
    const start = query.cursor ? Number(query.cursor) : 0;
    const end = start + query.limit;
    return { entries: all.slice(start, end), nextCursor: end < all.length ? String(end) : null };
  }

  // ------------------------------------------------------------------ connect and import

  connection(): ConnectionResponse {
    return {
      paypal: {
        environment: 'sandbox',
        connected: true,
        merchantId: 'MOCKMERCHANT01',
        accountEmail: 'maya-studio@business.example.com',
      },
      lastSyncedAt: this.lastSyncedAt,
      counts: { openInvoices: 5, allInvoices: 7, transactions: 24 },
      balance: {
        available: fromCents(BALANCE),
        currency: 'USD',
        source: 'PAYPAL_BALANCES',
        asOf: NOW,
      },
      demo: true,
    };
  }

  sync(): { sync: SyncResponse; events: ServerEvent[] } {
    this.lastSyncedAt = '2026-11-09T10:30:00Z';
    const sync: SyncResponse = {
      syncedAt: this.lastSyncedAt,
      invoices: { imported: 0, updated: 1, unchanged: 6, total: 7 },
      transactions: {
        imported: 2,
        total: 24,
        coveredFrom: '2026-10-10T00:00:00Z',
        coveredTo: '2026-11-09T08:00:00Z',
      },
      balance: {
        available: fromCents(BALANCE),
        currency: 'USD',
        source: 'PAYPAL_BALANCES',
        asOf: this.lastSyncedAt,
      },
    };
    this.world().log(
      'SYNC_COMPLETED',
      'Imported invoices and transactions from PayPal.',
      'SYSTEM',
      'BUSINESS',
      'biz_maya',
    );
    return {
      sync,
      events: [
        {
          id: `sync-${Date.now().toString()}`,
          type: 'sync.completed',
          at: this.lastSyncedAt,
          data: { sync },
        },
      ],
    };
  }

  // ------------------------------------------------------------------ the public offer page

  offer(token: string): PublicOffer {
    const record = this.offers.get(token);
    if (!record) throw new TokenError('This link isn’t valid. Ask Maya Studio for a new one.');
    if (token === 'demo-used') throw new TokenError('This link has already been used.');
    return record.offer;
  }

  reply(token: string, request: OfferReplyRequest): OfferReplyResponse {
    const record = this.offers.get(token);
    if (!record) throw new TokenError('This link isn’t valid. Ask Maya Studio for a new one.');
    if (record.replied || token === 'demo-used')
      throw new TokenError('This link has already been used.');
    const offer = record.offer;
    if (offer.state !== 'OPEN') throw new TokenError('This offer is no longer open.');

    let next: PublicOffer = offer;
    let parsed: ParsedReply | null = null;
    let message: string;
    switch (request.kind) {
      case 'PAY_NOW':
        next = { ...offer, state: 'ACCEPTED' };
        message =
          'Thank you. Maya Studio is updating the PayPal invoice with the discount, and PayPal will email it to you to pay.';
        break;
      case 'PAY_PART': {
        const amount = toCents(request.amountEarly);
        const min = toCents(offer.minPartial ?? '0.00');
        if (amount < min || amount >= toCents(offer.invoiceAmount)) {
          throw new DeskValidationError(
            `Choose an amount from ${offer.minPartial ?? '0.00'} up to less than the invoice.`,
          );
        }
        const discount = discountOn(amount, percentToBps(offer.terms.discountPct));
        next = {
          ...offer,
          state: 'ACCEPTED',
          terms: {
            ...offer.terms,
            amountEarly: request.amountEarly,
            remainderDue: offer.originalDueDate,
          },
          payNow: fromCents(amount - discount),
          discountAmount: fromCents(discount),
        };
        message =
          'Thank you. The PayPal invoice will show the part you pay now; the rest stays due on the original date.';
        break;
      }
      case 'NOT_NOW':
        next = { ...offer, state: 'DECLINED' };
        message = 'No problem. The invoice stays due on its original date.';
        break;
      case 'TEXT': {
        const text = request.text.toLowerCase();
        if (text.includes('half') && text.includes('monday')) {
          const half = toCents(offer.invoiceAmount) / 2n;
          const date = nextWeekday(TODAY, 1, true);
          parsed = {
            interpretation: 'PROMISE_TO_PAY',
            terms: null,
            promise: { amount: fromCents(half), date },
            summary: `$${(Number(half) / 100).toLocaleString('en-US')} on Monday`,
          };
          next = { ...offer, state: 'COUNTERED' };
          message = 'Thanks, we’ve passed that on to Maya Studio.';
        } else {
          parsed = {
            interpretation: 'NO_CHANGE',
            terms: null,
            promise: null,
            summary: 'No change to the offer',
          };
          message = 'Thanks, we’ve passed your note on. The offer itself hasn’t changed.';
        }
        break;
      }
    }
    record.offer = next;
    record.replied = request.kind !== 'TEXT' || parsed?.interpretation !== 'NO_CHANGE';
    this.world().log(
      'OFFER_REPLY',
      `Offer page reply: ${request.kind.toLowerCase().replace('_', ' ')}.`,
      'CLIENT_HUMAN',
      'INVOICE',
      offer.invoiceNumber,
    );
    return { offer: next, message, parsed };
  }
}
