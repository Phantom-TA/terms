import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';
import { AppError, conflict, forbidden, notFound, policyBlocked } from '../src/errors.js';
import { dateToIso, isoToDate, money, moneyOrNull, toAuditJson } from '../src/mappers.js';

const base = { DATABASE_URL: 'postgresql://x/y' };

describe('loadConfig', () => {
  it('runs without PayPal or LLM credentials and reports them unconfigured', () => {
    const c = loadConfig({ ...base, PAYPAL_CLIENT_ID: '', LLM_API_KEY: '' });
    expect(c.paypal.configured).toBe(false);
    expect(c.paypal.baseUrl).toBe('https://api-m.sandbox.paypal.com');
    expect(c.llm.configured).toBe(false);
    expect(c.port).toBe(3000);
  });

  it('reads PayPal and LLM settings', () => {
    const c = loadConfig({
      ...base,
      PAYPAL_CLIENT_ID: 'id',
      PAYPAL_CLIENT_SECRET: 'secret',
      PAYPAL_ENV: 'live',
      LLM_API_KEY: 'k',
      APP_BASE_URL: 'https://terms.example.com/',
    });
    expect(c.paypal.configured).toBe(true);
    expect(c.paypal.baseUrl).toBe('https://api-m.paypal.com');
    expect(c.llm.configured).toBe(true);
    expect(c.appBaseUrl).toBe('https://terms.example.com');
  });

  it('rejects a missing database URL and weak production secrets', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', SESSION_SECRET: 'short' })).toThrow(
      'SESSION_SECRET must be set',
    );
    const strong = 'x'.repeat(32);
    expect(
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        SESSION_SECRET: strong,
        OFFER_TOKEN_SECRET: strong,
      }).env,
    ).toBe('production');
  });
});

describe('mappers', () => {
  it('converts dates and money', () => {
    expect(dateToIso(isoToDate('2026-11-13'))).toBe('2026-11-13');
    expect(money(172900n)).toBe('1729.00');
    expect(moneyOrNull(null)).toBeNull();
    expect(moneyOrNull(1n)).toBe('0.01');
  });

  it('makes audit JSON safe', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: { h: { i: { j: 1 } } } } } } } } } };
    expect(JSON.stringify(toAuditJson(deep))).toContain('[truncated]');
    expect(toAuditJson([new Date('2026-01-01T00:00:00Z'), 5n])).toEqual([
      '2026-01-01T00:00:00.000Z',
      '5',
    ]);
  });
});

describe('AppError', () => {
  it('maps to the shared error body', () => {
    const err = new AppError('POLICY_BLOCKED', 'Blocked', {
      policyChecks: [{ rule: 'maxDiscount', result: 'blocked', detail: 'too high' }],
    });
    expect(err.status).toBe(422);
    expect(err.toBody('req_1')).toEqual({
      error: {
        code: 'POLICY_BLOCKED',
        message: 'Blocked',
        retryable: false,
        requestId: 'req_1',
        policyChecks: [{ rule: 'maxDiscount', result: 'blocked', detail: 'too high' }],
      },
    });
  });

  it('has helpers for common errors', () => {
    expect(notFound('Deal').toBody()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Deal not found', retryable: false },
    });
    expect(conflict('Plan already approved').status).toBe(409);
    expect(forbidden().message).toBe('Not allowed for this business');
    expect(policyBlocked('No', []).code).toBe('POLICY_BLOCKED');
    const paypal = new AppError('PAYPAL_ERROR', 'PayPal failed', {
      retryable: true,
      issues: [{ path: 'x', message: 'y' }],
      paypal: { debugId: 'dbg', name: 'INTERNAL', message: 'boom', httpStatus: 500 },
      cause: new Error('root'),
    });
    expect(paypal.toBody().error).toMatchObject({
      retryable: true,
      issues: [{ path: 'x', message: 'y' }],
      paypal: { debugId: 'dbg' },
    });
    expect(paypal.cause).toBeInstanceOf(Error);
  });
});
