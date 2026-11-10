import { mkdtempSync, writeFileSync } from 'node:fs';
import { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ApiErrorBody,
  ClientPolicyResponse,
  dollars,
  endpoints,
  HealthResponse,
  ListApprovalsResponse,
  ListAuditResponse,
  ListBusinessesResponse,
  ServerEvent,
  SessionResponse,
  SupplierPolicyResponse,
} from '@terms/shared';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { type z } from 'zod';
import { errorHandler } from '../../src/http/app.js';
import { route } from '../../src/http/route.js';
import { SessionService } from '../../src/http/session.js';
import { testApp } from '../helpers/app.js';
import { createTestDb, resetDb } from '../helpers/db.js';
import { type ScenarioIds, seedScenario } from '../helpers/fixtures.js';

const db = createTestDb();
let ids: ScenarioIds;

beforeEach(async () => {
  await resetDb(db);
  ids = await seedScenario(db);
});

afterAll(async () => {
  await db.$disconnect();
});

/** A supertest agent (keeps cookies) signed in as one business. */
async function signedIn(app: express.Express, businessId: string) {
  const agent = request.agent(app);
  await agent.post('/api/session').send({ businessId }).expect(201);
  return agent;
}

const errorCode = (body: unknown) => ApiErrorBody.parse(body).error.code;

describe('HTTP core', () => {
  it('reports health, request ids and the shared error body', async () => {
    const { app } = testApp(db);
    const health = await request(app).get('/api/health').expect(200);
    expect(HealthResponse.parse(health.body)).toMatchObject({
      status: 'ok',
      database: 'ok',
      paypalEnvironment: 'sandbox',
      paypalConfigured: true,
      aiConfigured: false,
    });
    expect(health.headers['x-request-id']).toMatch(/^[\w-]{8,64}$/);

    const missing = await request(app)
      .get('/api/nope')
      .set('X-Request-Id', 'trace-1234')
      .expect(404);
    expect(missing.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'No such API route',
        retryable: false,
        requestId: 'trace-1234',
      },
    });

    const bad = await request(app)
      .post('/api/session')
      .set('Content-Type', 'application/json')
      .send('{"businessId":')
      .expect(400);
    expect(ApiErrorBody.parse(bad.body).error).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'Malformed JSON',
    });

    const invalid = await request(app)
      .post('/api/session')
      .send({ businessId: '', extra: 1 })
      .expect(400);
    expect(ApiErrorBody.parse(invalid.body).error.issues?.length).toBeGreaterThan(0);
  });

  it('lists the businesses a visitor can act as', async () => {
    const { app } = testApp(db);
    const res = await request(app).get('/api/businesses').expect(200);
    const { businesses } = ListBusinessesResponse.parse(res.body);
    expect(businesses[0]).toMatchObject({ name: 'Maya Studio', role: 'SUPPLIER' });
    expect(businesses.map((b) => b.name)).toContain('Harbor & Co');
  });

  it('runs demo sessions in an httpOnly cookie and enforces who may call what', async () => {
    const { app } = testApp(db);
    const start = await request(app)
      .post('/api/session')
      .send({ businessId: ids.maya })
      .expect(201);
    const cookie = start.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(/^terms_session=[\w-]+; Path=\/; HttpOnly; SameSite=Lax; Expires=/);
    expect(cookie).not.toContain('Secure'); // test, not production
    expect(SessionResponse.parse(start.body)).toMatchObject({
      business: { id: ids.maya },
      demo: true,
    });
    // Only a hash of the token is stored.
    const token = /terms_session=([^;]+)/.exec(cookie)![1]!;
    expect(await db.session.count({ where: { tokenHash: token } })).toBe(0);

    const owner = request.agent(app);
    await owner.post('/api/session').send({ businessId: ids.maya });
    await owner.get('/api/session').expect(200);
    await owner.get('/api/supplier/policy').expect(200);
    expect(errorCode((await owner.get('/api/client/policy').expect(403)).body)).toBe('FORBIDDEN');

    const client = await signedIn(app, ids.harbor);
    expect(errorCode((await client.get('/api/supplier/policy').expect(403)).body)).toBe(
      'FORBIDDEN',
    );
    expect(errorCode((await request(app).get('/api/session').expect(401)).body)).toBe(
      'UNAUTHENTICATED',
    );
    await request(app).get('/api/session').set('Cookie', 'terms_session=forged').expect(401);

    const ended = await owner.delete('/api/session').expect(204);
    expect(ended.headers['set-cookie']?.[0]).toContain('Expires=Thu, 01 Jan 1970');
    await owner.get('/api/session').expect(401);
    await request(app).post('/api/session').send({ businessId: 'missing' }).expect(404);
  });

  it('serves and replaces both policies, validating against known businesses', async () => {
    const { app } = testApp(db);
    const owner = await signedIn(app, ids.maya);
    const got = SupplierPolicyResponse.parse(
      (await owner.get('/api/supplier/policy').expect(200)).body,
    );
    expect(got.policy).toMatchObject({
      maxDiscountPct: '1.20',
      costCeiling: '60.00',
      bufferPct: '5.00',
    });
    expect(got.policy.doNotContact.map((b) => b.name)).toEqual(['Pinecrest Dental', 'Birch Legal']);

    const next = {
      maxDiscountPct: '1.50',
      openingDiscountPct: '1.00',
      doNotContactIds: [ids.birch],
      bufferPct: '5.00',
      costCeiling: '80.00',
      tone: 'FORMAL',
    };
    const put = SupplierPolicyResponse.parse(
      (await owner.put('/api/supplier/policy').send(next).expect(200)).body,
    );
    expect(put.policy).toMatchObject({
      maxDiscountPct: '1.50',
      costCeiling: '80.00',
      tone: 'FORMAL',
    });
    await owner
      .put('/api/supplier/policy')
      .send({ ...next, doNotContactIds: ['nobody'] })
      .expect(400);
    await owner
      .put('/api/supplier/policy')
      .send({ ...next, openingDiscountPct: '2.00' })
      .expect(400);

    const harbor = await signedIn(app, ids.harbor);
    const policy = ClientPolicyResponse.parse(
      (await harbor.get('/api/client/policy').expect(200)).body,
    );
    expect(policy.policy).toMatchObject({
      hurdleRatePct: '15.00',
      autoPayLimit: '2000.00',
      earlyPayCapPerDeal: '5000.00',
    });
    const clientPut = {
      hurdleRatePct: '14.00',
      targetRatePct: '20.00',
      cashBuffer: '15000.00',
      autoPayLimit: '2500.00',
      earlyPayCapPerDeal: null,
      neverPayEarlyIds: [],
    };
    const saved = ClientPolicyResponse.parse(
      (await harbor.put('/api/client/policy').send(clientPut).expect(200)).body,
    );
    expect(saved.policy).toMatchObject({ hurdleRatePct: '14.00', earlyPayCapPerDeal: null });
    // The declared cash is the client's own figure and survives a policy change.
    expect(
      (await db.clientPolicy.findUniqueOrThrow({ where: { businessId: ids.harbor } }))
        .cashOnHandCents,
    ).toBe(dollars(60000));
    await harbor
      .put('/api/client/policy')
      .send({ ...clientPut, neverPayEarlyIds: [ids.juniper] })
      .expect(400);
    await harbor
      .put('/api/client/policy')
      .send({ ...clientPut, targetRatePct: '10.00' })
      .expect(400);

    // A business without a policy yet gets a 404, then can create one.
    const oak = await signedIn(app, ids.oak);
    await oak.get('/api/client/policy').expect(404);
    await oak.put('/api/client/policy').send(clientPut).expect(200);
  });

  it('lists and decides approvals for the addressed business only, and audits per business', async () => {
    const { app, services } = testApp(db);
    const approval = await services.approvals.request(db, {
      type: 'CLIENT_PAYMENT',
      subjectType: 'BUSINESS',
      subjectId: ids.harbor,
      requestedFrom: 'CLIENT_HUMAN',
      businessId: ids.harbor,
      visibleTo: [ids.maya],
      title: 'Approve $1,729.00 to Maya Studio',
      summary: 'test',
      paymentAmountCents: dollars(1729),
      actor: 'CLIENT_AGENT',
    });
    const harbor = await signedIn(app, ids.harbor);
    const list = ListApprovalsResponse.parse(
      (await harbor.get('/api/approvals?decision=PENDING').expect(200)).body,
    );
    expect(list.approvals.map((a) => a.id)).toEqual([approval.id]);
    await harbor.get('/api/approvals?decision=MAYBE').expect(400);

    const maya = await signedIn(app, ids.maya);
    expect(
      errorCode(
        (
          await maya
            .post(`/api/approvals/${approval.id}`)
            .send({ decision: 'APPROVED' })
            .expect(403)
        ).body,
      ),
    ).toBe('FORBIDDEN');
    const decided = await harbor
      .post(`/api/approvals/${approval.id}`)
      .send({ decision: 'APPROVED', note: 'ok' })
      .expect(200);
    expect(decided.body).toMatchObject({
      approval: { decision: 'APPROVED', decisionNote: 'ok' },
      paypalApprovalUrl: null,
    });
    await harbor.post(`/api/approvals/${approval.id}`).send({ decision: 'REJECTED' }).expect(409);

    const trail = ListAuditResponse.parse(
      (await harbor.get('/api/audit?limit=10').expect(200)).body,
    );
    expect(trail.entries.map((e) => e.action)).toEqual(
      expect.arrayContaining(['APPROVAL_DECIDED', 'APPROVAL_REQUESTED', 'SESSION_STARTED']),
    );
    const mayaTrail = ListAuditResponse.parse(
      (await maya.get('/api/audit?limit=50').expect(200)).body,
    );
    expect(mayaTrail.entries.some((e) => e.summary.includes('Harbor & Co'))).toBe(false);
  });
});

describe('server-sent events', () => {
  async function open(app: express.Express, businessId: string, lastEventId?: string) {
    const server = app.listen(0);
    const { port } = server.address() as AddressInfo;
    const login = await fetch(`http://127.0.0.1:${String(port)}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ businessId }),
    });
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${String(port)}/api/stream`, {
      headers: { cookie, ...(lastEventId === undefined ? {} : { 'last-event-id': lastEventId }) },
      signal: controller.signal,
    });
    const reader = res.body!.getReader();
    let buffer = '';
    const next = async (): Promise<{ id: string | null; event: ServerEvent }> => {
      for (;;) {
        const end = buffer.indexOf('\n\n');
        if (end >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const id = /^id: (.*)$/m.exec(frame)?.[1] ?? null;
          const data = /^data: (.*)$/m.exec(frame)![1]!;
          return { id, event: ServerEvent.parse(JSON.parse(data)) };
        }
        const chunk = await reader.read();
        if (chunk.done) throw new Error('stream closed');
        buffer += new TextDecoder().decode(chunk.value as Uint8Array);
      }
    };
    const close = () => {
      controller.abort();
      server.close();
    };
    return { res, next, close };
  }

  it('streams live events to the right business and replays from Last-Event-ID', async () => {
    const { app, services } = testApp(db);
    const harbor = await open(app, ids.harbor);
    expect(harbor.res.headers.get('content-type')).toContain('text/event-stream');
    // Starting the session was audited and streamed to Harbor itself (or replayed).
    const first = await harbor.next();
    expect(first.event.type).toBe('audit.appended');

    await services.events.publish([ids.maya], { type: 'heartbeat', data: {} }); // not for Harbor
    await services.events.publish([ids.harbor], {
      type: 'webhook.received',
      data: {
        paypalEventId: 'WH-1',
        eventType: 'PAYMENT.CAPTURE.COMPLETED',
        verified: true,
        duplicate: false,
      },
    });
    const live = await harbor.next();
    expect(live.event).toMatchObject({ type: 'webhook.received', data: { paypalEventId: 'WH-1' } });
    harbor.close();

    // Reconnecting after the first event replays only what came after it.
    const again = await open(app, ids.harbor, first.id!);
    const replayed = await again.next();
    expect(replayed.event.type).toBe('webhook.received');
    expect(BigInt(replayed.id!)).toBeGreaterThan(BigInt(first.id!));
    again.close();
  });
});

describe('route contract and the web app', () => {
  it('refuses to send a response that breaks its contract', async () => {
    const { app, services } = testApp(db);
    const router = express.Router();
    route(router, new SessionService(db), { ...endpoints.health, path: '/api/broken' }, () =>
      Promise.resolve({ status: 'nonsense' } as unknown as z.input<typeof HealthResponse>),
    );
    const outer = express();
    outer.use(router);
    outer.use(errorHandler(services));
    expect(app).toBeDefined();
    const res = await request(outer).get('/api/broken').expect(500);
    expect(errorCode(res.body)).toBe('INTERNAL');
    expect(services.config.env).toBe('test');
  });

  it('serves the built web app for every non-API path, including /offer/:token', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'terms-web-'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Terms</title>');
    writeFileSync(join(dist, 'app.js'), 'console.log(1)');
    const { app } = testApp(db, { webDist: dist });
    expect((await request(app).get('/offer/abc.def').expect(200)).text).toContain(
      '<title>Terms</title>',
    );
    expect((await request(app).get('/app.js').expect(200)).text).toContain('console.log');
    expect(errorCode((await request(app).get('/api/unknown').expect(404)).body)).toBe('NOT_FOUND');
  });
});
