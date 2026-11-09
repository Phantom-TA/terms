/**
 * Spike S3 receiver (CONTEXT.md): which webhook events fire for invoice payment and capture in the
 * sandbox, and does verification pass?
 *
 * A bare HTTP server on S3_PORT (default 8787) that accepts POST /api/webhooks/paypal, keeps the raw
 * body, and checks each event two ways:
 *  1. PayPal's API: POST /v1/notifications/verify-webhook-signature with the parsed event;
 *  2. locally: CRC32 of the raw body and the transmission headers, verified with PayPal's
 *     certificate (SHA256withRSA), fetched only from a paypal.com host.
 * Each event and both results are saved under scripts/spikes/out/s3-events/.
 *
 *   pnpm spike ../../scripts/spikes/s3-webhook-receiver.ts
 * The webhook id comes from scripts/spikes/out/s3-webhook.json (written by s3-webhooks.ts).
 */
import { createVerify, X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { crc32 } from 'node:zlib';
import { z } from 'zod';
import { classify } from '../../apps/api/src/paypal/errors.js';
import { rest } from './lib.js';

const PORT = Number(process.env['S3_PORT'] ?? 8787);
const outDir = new URL('./out/s3-events/', import.meta.url);
mkdirSync(outDir, { recursive: true });

function webhookId(): string {
  const path = new URL('./out/s3-webhook.json', import.meta.url);
  if (!existsSync(path)) throw new Error('Register the webhook first (s3-webhooks.ts register)');
  return (JSON.parse(readFileSync(path, 'utf8')) as { id: string }).id;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

function header(req: IncomingMessage, name: string): string | null {
  const v = req.headers[name];
  return typeof v === 'string' ? v : null;
}

async function verifyWithApi(req: IncomingMessage, event: unknown, id: string): Promise<string> {
  try {
    const res = await rest.request({
      method: 'POST',
      path: '/v1/notifications/verify-webhook-signature',
      body: {
        auth_algo: header(req, 'paypal-auth-algo'),
        cert_url: header(req, 'paypal-cert-url'),
        transmission_id: header(req, 'paypal-transmission-id'),
        transmission_sig: header(req, 'paypal-transmission-sig'),
        transmission_time: header(req, 'paypal-transmission-time'),
        webhook_id: id,
        webhook_event: event,
      },
      schema: z.looseObject({ verification_status: z.string() }),
    });
    return res.data.verification_status;
  } catch (err) {
    const f = classify(err);
    return `error ${f.kind} ${String(f.status)} ${f.reason ?? ''}`;
  }
}

const certCache = new Map<string, string>();

async function verifyLocally(req: IncomingMessage, raw: Buffer, id: string): Promise<string> {
  const certUrl = header(req, 'paypal-cert-url');
  const transmissionId = header(req, 'paypal-transmission-id');
  const time = header(req, 'paypal-transmission-time');
  const sig = header(req, 'paypal-transmission-sig');
  if (certUrl === null || transmissionId === null || time === null || sig === null) {
    return 'missing headers';
  }
  const host = new URL(certUrl).hostname;
  if (new URL(certUrl).protocol !== 'https:' || !/(^|\.)paypal\.com$/.test(host)) {
    return `refused cert host ${host}`;
  }
  let pem = certCache.get(certUrl);
  if (pem === undefined) {
    pem = await (await fetch(certUrl)).text();
    certCache.set(certUrl, pem);
  }
  const cert = new X509Certificate(pem);
  const message = `${transmissionId}|${time}|${id}|${String(crc32(raw))}`;
  const ok = createVerify('sha256').update(message).verify(cert.publicKey, sig, 'base64');
  return ok ? 'SUCCESS' : 'FAILURE';
}

createServer((req, res) => {
  void (async () => {
    if (req.method !== 'POST' || req.url !== '/api/webhooks/paypal') {
      res.writeHead(404).end();
      return;
    }
    const raw = await readBody(req);
    res.writeHead(200).end(); // acknowledge fast; PayPal retries on non-2xx
    const event = JSON.parse(raw.toString('utf8')) as { id?: string; event_type?: string };
    const id = webhookId();
    const [api, local] = await Promise.all([
      verifyWithApi(req, event, id),
      verifyLocally(req, raw, id).catch((e: unknown) => `error ${String(e)}`),
    ]);
    const record = {
      receivedAt: new Date().toISOString(),
      eventId: event.id ?? null,
      eventType: event.event_type ?? null,
      verification: { api, local },
      headers: Object.fromEntries(
        Object.entries(req.headers).filter(([k]) => k.startsWith('paypal-')),
      ),
      event,
    };
    const name = `${Date.now().toString()}-${event.event_type ?? 'unknown'}.json`;
    writeFileSync(new URL(name, outDir), `${JSON.stringify(record, null, 2)}\n`);
    console.log(
      `${record.receivedAt} ${String(record.eventType)} ${String(record.eventId)} api=${api} local=${local}`,
    );
  })();
}).listen(PORT, () => {
  console.log(`S3 receiver on http://localhost:${String(PORT)}/api/webhooks/paypal`);
});
