/**
 * PayPal webhooks (spike S3; paypal-plan.md "Webhooks"). For every delivery:
 *  1. verify the signature with PayPal's verify-webhook-signature API; if that API cannot answer,
 *     verify locally (CRC32 of the raw body, SHA256withRSA against PayPal's certificate, fetched
 *     only from a paypal.com host);
 *  2. store the event once, keyed by PayPal's event id (re-deliveries reuse it);
 *  3. only then act on it: settle deals from captures and invoice payments (settlement.ts).
 * An unverified event is stored and audited as rejected, and never acted on.
 */
import { createVerify, X509Certificate } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { toCents } from '@terms/shared';
import { z } from 'zod';
import { type AuditLogger } from '../audit.js';
import { type Db } from '../db.js';
import { AppError } from '../errors.js';
import { Prisma } from '../generated/prisma/client.js';
import { classify, mayHaveTakenEffect, toAppError } from './errors.js';
import { WireInvoice } from './invoice-wire.js';
import { type PayPalRestClient } from './rest-client.js';
import { type Settlement } from './settlement.js';
import { sendClaimed, type WriteLedger } from './write-ledger.js';

/** The events Terms subscribes to (S3 listed the sandbox's names). */
export const WEBHOOK_EVENT_TYPES = [
  'PAYMENT.CAPTURE.COMPLETED',
  'PAYMENT.CAPTURE.PENDING',
  'PAYMENT.CAPTURE.DECLINED',
  'PAYMENT.CAPTURE.DENIED',
  'PAYMENT.CAPTURE.REFUNDED',
  'PAYMENT.CAPTURE.REVERSED',
  'INVOICING.INVOICE.PAID',
  'INVOICING.INVOICE.UPDATED',
  'INVOICING.INVOICE.CANCELLED',
  'INVOICING.INVOICE.SENT',
  'CHECKOUT.ORDER.APPROVED',
  'CHECKOUT.ORDER.COMPLETED',
  'VAULT.PAYMENT-TOKEN.CREATED',
  'VAULT.PAYMENT-TOKEN.DELETED',
] as const;

export const WEBHOOK_CALLS = {
  verify: 'POST /v1/notifications/verify-webhook-signature',
  list: 'GET /v1/notifications/webhooks',
  create: 'POST /v1/notifications/webhooks',
} as const;

/** The headers PayPal signs a delivery with; the route passes exactly these. */
export const PAYPAL_HEADERS = [
  'paypal-auth-algo',
  'paypal-cert-url',
  'paypal-transmission-id',
  'paypal-transmission-sig',
  'paypal-transmission-time',
] as const;
type PayPalHeader = (typeof PAYPAL_HEADERS)[number];
export type WebhookHeaders = Partial<Record<PayPalHeader, string>>;

const WebhookEnvelope = z.looseObject({
  id: z.string().min(1),
  event_type: z.string().min(1),
  resource_type: z.string().optional(),
  summary: z.string().optional(),
  resource: z.looseObject({}).optional(),
});

const CaptureResource = z.looseObject({
  id: z.string(),
  status: z.string(),
  amount: z.looseObject({ value: z.string() }),
  custom_id: z.string().optional(),
  supplementary_data: z
    .looseObject({ related_ids: z.looseObject({ order_id: z.string().optional() }).optional() })
    .optional(),
});

export type WebhookOutcome =
  /** Verified, stored and acted on (or nothing to do for this type). */
  | { status: 'processed'; eventId: string; type: string; detail: string }
  /** Already processed: PayPal re-delivered it. */
  | { status: 'duplicate'; eventId: string; type: string }
  /** Signature did not verify: stored for the audit trail, never acted on. */
  | { status: 'rejected'; eventId: string; type: string };

export interface WebhookServiceOptions {
  /** PAYPAL_WEBHOOK_ID: the id PayPal assigned when the endpoint was registered. */
  webhookId: string | null;
  /** Fetches PayPal's signing certificate for local verification (test seam). */
  fetchCert?: (url: string) => Promise<string>;
}

function isPayPalCertUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /(^|\.)paypal\.com$/.test(u.hostname);
  } catch {
    return false;
  }
}

export class WebhookService {
  private readonly certs = new Map<string, string>();
  private readonly fetchCert: (url: string) => Promise<string>;

  constructor(
    private readonly db: Db,
    private readonly rest: PayPalRestClient,
    private readonly ledger: WriteLedger,
    private readonly audit: AuditLogger,
    private readonly settlement: Settlement,
    private readonly options: WebhookServiceOptions,
  ) {
    this.fetchCert =
      options.fetchCert ??
      (async (url) => {
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) throw new Error(`certificate fetch failed with ${String(res.status)}`);
        return res.text();
      });
  }

  private webhookId(): string {
    if (this.options.webhookId === null) {
      throw new AppError('NOT_CONFIGURED', 'PAYPAL_WEBHOOK_ID is not set');
    }
    return this.options.webhookId;
  }

  /** PayPal's verify-webhook-signature API. Returns null when the API itself could not answer. */
  private async verifyWithApi(
    headers: WebhookHeaders,
    event: unknown,
    webhookId: string,
  ): Promise<boolean | null> {
    try {
      const res = await this.rest.request({
        method: 'POST',
        path: '/v1/notifications/verify-webhook-signature',
        body: {
          auth_algo: headers['paypal-auth-algo'],
          cert_url: headers['paypal-cert-url'],
          transmission_id: headers['paypal-transmission-id'],
          transmission_sig: headers['paypal-transmission-sig'],
          transmission_time: headers['paypal-transmission-time'],
          webhook_id: webhookId,
          webhook_event: event,
        },
        schema: z.looseObject({ verification_status: z.string() }),
      });
      return res.data.verification_status === 'SUCCESS';
    } catch (err) {
      const f = classify(err);
      // A refusal (e.g. malformed headers) is a verdict; an outage is not.
      return f.kind === 'refused' ? false : null;
    }
  }

  /** Local verification over the raw body (S3: matches the API's verdict). */
  async verifyLocally(raw: Buffer, headers: WebhookHeaders, webhookId: string): Promise<boolean> {
    const certUrl = headers['paypal-cert-url'];
    const id = headers['paypal-transmission-id'];
    const time = headers['paypal-transmission-time'];
    const sig = headers['paypal-transmission-sig'];
    if (certUrl === undefined || id === undefined || time === undefined || sig === undefined) {
      return false;
    }
    if (!isPayPalCertUrl(certUrl)) return false;
    let pem = this.certs.get(certUrl);
    if (pem === undefined) {
      pem = await this.fetchCert(certUrl);
      this.certs.set(certUrl, pem);
    }
    const message = `${id}|${time}|${webhookId}|${String(crc32(raw))}`;
    try {
      return createVerify('sha256')
        .update(message)
        .verify(new X509Certificate(pem).publicKey, sig, 'base64');
    } catch {
      return false;
    }
  }

  /**
   * Handles one delivery. `raw` is the body exactly as received (before any JSON parsing).
   * Throws only when processing a verified event failed, so PayPal re-delivers it later.
   */
  async receive(raw: Buffer, headers: WebhookHeaders): Promise<WebhookOutcome> {
    const webhookId = this.webhookId();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString('utf8')) as unknown;
    } catch {
      throw new AppError('VALIDATION_FAILED', 'Webhook body is not JSON');
    }
    const envelope = WebhookEnvelope.safeParse(parsed);
    if (!envelope.success) throw new AppError('VALIDATION_FAILED', 'Not a PayPal webhook event');
    const event = envelope.data;

    const existing = await this.db.webhookEvent.findUnique({ where: { paypalEventId: event.id } });
    if ((existing?.processedAt ?? null) !== null && existing !== null) {
      await this.audit.write(this.db, {
        actor: 'PAYPAL',
        action: 'WEBHOOK_DUPLICATE',
        subjectType: 'WEBHOOK_EVENT',
        subjectId: existing.id,
        businessIds: await this.ownerIds(),
        summary: `${event.event_type} ${event.id} delivered again; already processed`,
        webhookVerified: existing.verified,
      });
      return { status: 'duplicate', eventId: event.id, type: event.event_type };
    }

    const apiVerdict = await this.verifyWithApi(headers, parsed, webhookId);
    const verified = apiVerdict ?? (await this.verifyLocally(raw, headers, webhookId));
    const verificationStatus =
      apiVerdict === null
        ? `LOCAL_${verified ? 'SUCCESS' : 'FAILURE'}`
        : verified
          ? 'SUCCESS'
          : 'FAILURE';

    const stored =
      existing ??
      (await this.db.webhookEvent
        .create({
          data: {
            paypalEventId: event.id,
            type: event.event_type,
            verified,
            verificationStatus,
            payload: parsed as Prisma.InputJsonObject,
          },
        })
        .catch(async (err: unknown) => {
          // A concurrent delivery of the same event stored it first.
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            return this.db.webhookEvent.findUniqueOrThrow({ where: { paypalEventId: event.id } });
          }
          throw err;
        }));

    if (!verified) {
      await this.audit.write(this.db, {
        actor: 'PAYPAL',
        action: 'WEBHOOK_REJECTED',
        subjectType: 'WEBHOOK_EVENT',
        subjectId: stored.id,
        businessIds: await this.ownerIds(),
        summary: `${event.event_type} ${event.id} failed signature verification; ignored`,
        details: { verificationStatus },
        webhookVerified: false,
        paypalCall: WEBHOOK_CALLS.verify,
      });
      return { status: 'rejected', eventId: event.id, type: event.event_type };
    }

    try {
      const detail = await this.process(event.event_type, event.resource ?? {}, stored.id);
      await this.db.webhookEvent.update({
        where: { id: stored.id },
        data: { processedAt: new Date(), processingError: null },
      });
      return { status: 'processed', eventId: event.id, type: event.event_type, detail };
    } catch (err) {
      await this.db.webhookEvent.update({
        where: { id: stored.id },
        data: { processingError: err instanceof Error ? err.message.slice(0, 500) : 'failed' },
      });
      throw err;
    }
  }

  private async process(type: string, resource: Record<string, unknown>, storedId: string) {
    const source = `webhook ${type}`;
    let detail: string;
    let dealId: string | null = null;
    let businessIds = await this.ownerIds();
    if (type === 'PAYMENT.CAPTURE.COMPLETED') {
      const capture = CaptureResource.parse(resource);
      dealId = capture.custom_id ?? null;
      const result = await this.settlement.fromCapture({
        captureId: capture.id,
        dealId,
        status: capture.status,
        amountCents: toCents(capture.amount.value),
        orderId: capture.supplementary_data?.related_ids?.order_id ?? null,
        source,
      });
      detail = result.settled ? `deal ${result.deal.state}` : result.reason;
      if (result.settled) businessIds = await this.dealBusinesses(result.deal.id);
    } else if (type.startsWith('INVOICING.INVOICE.')) {
      const invoice = WireInvoice.parse((resource as { invoice?: unknown }).invoice ?? resource);
      const result = await this.settlement.fromInvoice(invoice, source);
      detail = result.settled ? `deal ${result.deal.state}` : result.reason;
      if (result.settled) {
        dealId = result.deal.id;
        businessIds = await this.dealBusinesses(result.deal.id);
      }
    } else {
      detail = 'recorded; no action for this type';
    }
    await this.audit.write(this.db, {
      actor: 'PAYPAL',
      action: 'WEBHOOK_VERIFIED',
      subjectType: 'WEBHOOK_EVENT',
      subjectId: storedId,
      dealId,
      businessIds,
      summary: `${type} verified: ${detail}`,
      webhookVerified: true,
      paypalCall: WEBHOOK_CALLS.verify,
    });
    return detail;
  }

  /** Webhooks belong to the PayPal account owner: the supplier businesses see them. */
  private async ownerIds(): Promise<string[]> {
    const owners = await this.db.business.findMany({
      where: { role: 'SUPPLIER' },
      select: { id: true },
    });
    return owners.map((o) => o.id);
  }

  private async dealBusinesses(dealId: string): Promise<string[]> {
    const deal = await this.db.deal.findUniqueOrThrow({
      where: { id: dealId },
      select: { clientId: true, plan: { select: { goal: { select: { supplierId: true } } } } },
    });
    return [deal.plan.goal.supplierId, deal.clientId];
  }

  /**
   * Makes sure PayPal delivers to `url`; returns the webhook id to put in PAYPAL_WEBHOOK_ID.
   * Registering is claimed like any other write, so two deploys never create two webhooks.
   */
  async ensureRegistered(url: string): Promise<string> {
    const List = z.looseObject({
      webhooks: z.array(z.looseObject({ id: z.string(), url: z.string() })),
    });
    try {
      const listed = await this.rest.request({
        method: 'GET',
        path: '/v1/notifications/webhooks',
        schema: List,
      });
      const found = listed.data.webhooks.find((w) => w.url === url);
      if (found !== undefined) return found.id;
    } catch (err) {
      throw toAppError(classify(err), 'webhook');
    }
    const claim = await this.ledger.claim(this.db, {
      key: `webhook:${url}`,
      operation: 'notifications.createWebhook',
    });
    if (claim.kind === 'existing' && claim.write.resultRef !== null) return claim.write.resultRef;
    const sent = await sendClaimed(this.ledger, this.db, claim.write, () =>
      this.rest.request({
        method: 'POST',
        path: '/v1/notifications/webhooks',
        requestId: claim.write.requestId,
        body: { url, event_types: WEBHOOK_EVENT_TYPES.map((name) => ({ name })) },
        schema: z.looseObject({ id: z.string() }),
      }),
    );
    if (!sent.ok) {
      if (sent.unknown || mayHaveTakenEffect(sent.failure)) {
        throw new AppError(
          'PAYPAL_ERROR',
          'PayPal may have registered the webhook; list webhooks to check',
          {
            retryable: true,
          },
        );
      }
      throw toAppError(sent.failure, 'webhook');
    }
    await this.ledger.succeed(this.db, claim.write.id, sent.value.data.id);
    await this.audit.write(this.db, {
      actor: 'SYSTEM',
      action: 'PAYPAL_REQUEST',
      subjectType: 'WEBHOOK_EVENT',
      subjectId: sent.value.data.id,
      businessIds: [],
      summary: `Registered PayPal webhook for ${url}`,
      details: { eventTypes: WEBHOOK_EVENT_TYPES.length },
      paypalCall: WEBHOOK_CALLS.create,
      paypalRequestId: claim.write.requestId,
    });
    return sent.value.data.id;
  }
}
