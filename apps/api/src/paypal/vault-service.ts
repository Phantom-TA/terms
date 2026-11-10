/**
 * Saving a client's PayPal method (spike S5; paypal-plan.md: vault rows). A person at the client
 * approves once on PayPal; the client's agent can then pay within its limit with no further clicks.
 *
 *  startSetup:    setup token (PayPal wallet, usage MERCHANT) → the approval link for the person.
 *  completeSetup: once PayPal reports the setup token APPROVED, exchange it for a payment token.
 *
 * Calls go through the APIMatic SDK. Each write is claimed in the ledger and carries the claim's
 * PayPal-Request-Id; a lost answer is settled by replaying the same request (sendClaimed).
 */
import { webPaths } from '@terms/shared';
import { type PaypalClient } from 'paypal';
import { type AuditLogger } from '../audit.js';
import { type Db } from '../db.js';
import { conflict, notFound } from '../errors.js';
import { type VaultToken } from '../generated/prisma/client.js';
import { classify, incompleteResponse, toAppError } from './errors.js';
import { callBudget } from './sdk-client.js';
import { outcomeUnknown, sendClaimed, type WriteLedger } from './write-ledger.js';

export const VAULT_CALLS = {
  createSetup: 'POST /v3/vault/setup-tokens',
  getSetup: 'GET /v3/vault/setup-tokens/{id}',
  createToken: 'POST /v3/vault/payment-tokens',
} as const;

export interface VaultStatusView {
  vaultTokenId: string;
  status: VaultToken['status'];
  /** Where the client's person approves; null once the method is saved. */
  approveUrl: string | null;
  paymentTokenId: string | null;
  payerEmail: string | null;
}

function view(row: VaultToken, approveUrl: string | null): VaultStatusView {
  return {
    vaultTokenId: row.id,
    status: row.status,
    approveUrl,
    paymentTokenId: row.paypalPaymentTokenId,
    payerEmail: row.payerEmail,
  };
}

export class VaultService {
  constructor(
    private readonly db: Db,
    private readonly sdk: PaypalClient,
    private readonly ledger: WriteLedger,
    private readonly audit: AuditLogger,
    private readonly appBaseUrl: string,
  ) {}

  private async client(clientId: string) {
    const business = await this.db.business.findUnique({ where: { id: clientId } });
    if (business?.role !== 'CLIENT') throw notFound('Client');
    return business;
  }

  /** The approval link of a setup token PayPal already holds. */
  private async approveLinkOf(
    setupTokenId: string,
  ): Promise<{ status: string; url: string | null }> {
    try {
      const setup = await this.sdk.vault.getSetupToken(
        { id: setupTokenId },
        { signal: callBudget() },
      );
      return {
        status: setup.status ?? 'UNKNOWN',
        url: setup.links?.find((l) => l.rel === 'approve')?.href ?? null,
      };
    } catch (err) {
      throw toAppError(classify(err), 'setup token');
    }
  }

  /** Starts saving the client's PayPal method, or returns the setup already under way. */
  async startSetup(clientId: string): Promise<VaultStatusView> {
    await this.client(clientId);
    const active = await this.db.vaultToken.findFirst({ where: { clientId, status: 'ACTIVE' } });
    if (active !== null) return view(active, null);

    // One pending setup per client, even under concurrent clicks.
    const row = await this.db.$transaction(
      async (tx) =>
        (await tx.vaultToken.findFirst({ where: { clientId, status: 'PENDING' } })) ??
        tx.vaultToken.create({ data: { clientId, status: 'PENDING' } }),
      { isolationLevel: 'Serializable' },
    );
    if (row.setupTokenId !== null) {
      const link = await this.approveLinkOf(row.setupTokenId);
      return view(row, link.url);
    }

    const claim = await this.ledger.claim(this.db, {
      key: `vault-setup:${row.id}`,
      operation: 'vault.createSetupToken',
    });
    const sent = await sendClaimed(this.ledger, this.db, claim.write, () =>
      this.sdk.vault.createSetupToken(
        {
          payPalRequestId: claim.write.requestId,
          body: {
            paymentSource: {
              paypal: {
                usageType: 'MERCHANT',
                experienceContext: {
                  returnUrl: `${this.appBaseUrl}${webPaths.vaultReturn()}`,
                  cancelUrl: `${this.appBaseUrl}${webPaths.vaultCancel()}`,
                },
              },
            },
          },
        },
        { signal: callBudget() },
      ),
    );
    if (!sent.ok) {
      if (sent.unknown) throw outcomeUnknown('started the setup', sent.failure);
      await this.db.vaultToken.update({ where: { id: row.id }, data: { status: 'FAILED' } });
      throw toAppError(sent.failure, 'setup token');
    }
    const setup = sent.value;
    const approveUrl = setup.links?.find((l) => l.rel === 'approve')?.href ?? null;
    if (setup.id === undefined || approveUrl === null) {
      // PayPal answered without what we need: we cannot name what it created.
      await this.ledger.markUnknown(this.db, claim.write.id, { kind: 'incomplete_response' });
      throw outcomeUnknown('started the setup', incompleteResponse(VAULT_CALLS.createSetup));
    }
    const setupTokenId = setup.id;
    const saved = await this.db.$transaction(async (tx) => {
      await this.ledger.succeed(tx, claim.write.id, setupTokenId);
      const updated = await tx.vaultToken.update({ where: { id: row.id }, data: { setupTokenId } });
      await this.audit.write(tx, {
        actor: 'CLIENT_AGENT',
        action: 'VAULT_SETUP_STARTED',
        subjectType: 'VAULT_TOKEN',
        subjectId: row.id,
        businessIds: [clientId],
        summary: 'Saving the PayPal method: waiting for a person to approve on PayPal',
        details: { setupTokenId, replayed: sent.replayed },
        paypalCall: VAULT_CALLS.createSetup,
        paypalRequestId: claim.write.requestId,
      });
      return updated;
    });
    return view(saved, approveUrl);
  }

  /** After the person approves on PayPal: exchange the setup token for a payment token. */
  async completeSetup(clientId: string): Promise<VaultStatusView> {
    await this.client(clientId);
    const active = await this.db.vaultToken.findFirst({ where: { clientId, status: 'ACTIVE' } });
    if (active !== null) return view(active, null);
    const row = await this.db.vaultToken.findFirst({
      where: { clientId, status: 'PENDING', setupTokenId: { not: null } },
    });
    const setupTokenId = row?.setupTokenId ?? null;
    if (row === null || setupTokenId === null) {
      throw conflict('No PayPal method setup is in progress');
    }

    const link = await this.approveLinkOf(setupTokenId);
    if (link.status !== 'APPROVED') return view(row, link.url);

    const claim = await this.ledger.claim(this.db, {
      key: `vault-token:${setupTokenId}`,
      operation: 'vault.createPaymentToken',
    });
    const sent = await sendClaimed(this.ledger, this.db, claim.write, () =>
      this.sdk.vault.createPaymentToken(
        {
          payPalRequestId: claim.write.requestId,
          body: { paymentSource: { token: { id: setupTokenId, type: 'SETUP_TOKEN' } } },
        },
        { signal: callBudget() },
      ),
    );
    if (!sent.ok) {
      if (sent.unknown) throw outcomeUnknown('saved the PayPal method', sent.failure);
      throw toAppError(sent.failure, 'setup token');
    }
    const token = sent.value;
    if (token.id === undefined) {
      await this.ledger.markUnknown(this.db, claim.write.id, { kind: 'incomplete_response' });
      throw outcomeUnknown('saved the PayPal method', incompleteResponse(VAULT_CALLS.createToken));
    }
    const paymentTokenId = token.id;
    const payerEmail = token.paymentSource?.paypal?.emailAddress ?? null;
    const saved = await this.db.$transaction(async (tx) => {
      await this.ledger.succeed(tx, claim.write.id, paymentTokenId);
      await tx.vaultToken.updateMany({
        where: { clientId, status: 'ACTIVE' },
        data: { status: 'REVOKED' },
      });
      const updated = await tx.vaultToken.update({
        where: { id: row.id },
        data: { status: 'ACTIVE', paypalPaymentTokenId: paymentTokenId, payerEmail },
      });
      await this.audit.write(tx, {
        actor: 'CLIENT_HUMAN',
        action: 'VAULT_TOKEN_CREATED',
        subjectType: 'VAULT_TOKEN',
        subjectId: row.id,
        businessIds: [clientId],
        summary: `PayPal method saved${payerEmail === null ? '' : ` (${payerEmail})`}; the agent can pay within its limit`,
        details: {
          paymentTokenId,
          customerId: token.customer?.id ?? null,
          replayed: sent.replayed,
        },
        paypalCall: VAULT_CALLS.createToken,
        paypalRequestId: claim.write.requestId,
      });
      return updated;
    });
    return view(saved, null);
  }
}
