/**
 * Shared setup for the PayPal sandbox spikes (CONTEXT.md, Build plan step 1). Spikes run against
 * the real sandbox with the credentials in the root .env, write their raw evidence to
 * scripts/spikes/out/ (gitignored) and print a short summary for docs/paypal.md.
 *
 * Run: pnpm spike ../../scripts/spikes/<file>.ts   (the runner's working directory is apps/api)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { loadConfig } from '../../apps/api/src/config.js';
import { classify } from '../../apps/api/src/paypal/errors.js';
import { PayPalRestClient } from '../../apps/api/src/paypal/rest-client.js';
import { buildPayPalSdkClient } from '../../apps/api/src/paypal/sdk-client.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
loadDotenv({ path: `${root}.env`, quiet: true });

export const config = loadConfig({
  ...process.env,
  DATABASE_URL: process.env['DATABASE_URL'] ?? 'postgresql://unused/unused',
});
if (config.paypal.environment !== 'sandbox') {
  throw new Error('Spikes run against the PayPal sandbox only');
}

export const rest = new PayPalRestClient(config.paypal);
export const sdk = buildPayPalSdkClient(config.paypal);

/** The demo's sandbox accounts (created by the owner on developer.paypal.com). */
export const accounts = {
  maya: 'maya@terms-demo.example.com',
  juniper: 'juniper@terms-demo.example.com',
  harbor: 'harbor@terms-demo.example.com',
  oak: 'oak@terms-demo.example.com',
} as const;

const outDir = `${root}scripts/spikes/out`;

/** Saves raw evidence. Responses hold sandbox ids and amounts only; tokens are never captured. */
export function save(name: string, evidence: unknown): string {
  mkdirSync(outDir, { recursive: true });
  const path = `${outDir}/${name}.json`;
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`);
  return path;
}

export function isoDate(daysFromToday: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

/** Runs a spike step and prints a PayPal failure readably instead of a stack trace. */
export async function step<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    const result = await run();
    console.log(`  ok   ${label}`);
    return result;
  } catch (err) {
    const f = classify(err);
    console.log(
      `  FAIL ${label}: ${f.kind} ${f.status ?? ''} ${f.name ?? ''} ${f.reason ?? ''} (debug ${f.debugId ?? '-'})`,
    );
    throw err;
  }
}
