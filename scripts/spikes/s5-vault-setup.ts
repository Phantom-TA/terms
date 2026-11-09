/**
 * Spike S5 (CONTEXT.md): does vault setup for a PayPal wallet work in the sandbox for a client?
 *
 *   pnpm spike ../../scripts/spikes/s5-vault-setup.ts start
 *     Creates a setup token (usage MERCHANT) and prints the approval link. A person at Harbor & Co
 *     opens it, signs in to the sandbox as harbor@terms-demo.example.com and approves.
 *   pnpm spike ../../scripts/spikes/s5-vault-setup.ts finish
 *     Reads the setup token; once APPROVED, exchanges it for a payment token and prints its id and
 *     the PayPal customer id. Spike S2 charges that token.
 *
 * SDK calls follow paypal-plan.md (vault.createSetupToken, getSetupToken, createPaymentToken).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { config, save, sdk, step } from './lib.js';

const STATE = 's5-vault-state';
const statePath = new URL('./out/s5-vault-state.json', import.meta.url);

interface VaultState {
  setupTokenId: string;
  approveUrl: string;
  createdAt: string;
  paymentTokenId?: string;
  customerId?: string;
  payerEmail?: string | null;
}

function readState(): VaultState {
  return JSON.parse(readFileSync(statePath, 'utf8')) as VaultState;
}

async function start(): Promise<void> {
  const setup = await step('vault.createSetupToken (PayPal wallet, MERCHANT)', () =>
    sdk.vault.createSetupToken({
      payPalRequestId: randomUUID(),
      body: {
        paymentSource: {
          paypal: {
            usageType: 'MERCHANT',
            experienceContext: {
              returnUrl: `${config.appBaseUrl}/client/vault/return`,
              cancelUrl: `${config.appBaseUrl}/client/vault/cancel`,
            },
          },
        },
      },
    }),
  );
  const approveUrl = setup.links?.find((l) => l.rel === 'approve')?.href;
  if (setup.id === undefined || approveUrl === undefined) {
    throw new Error('Setup token response has no id or approve link');
  }
  const state: VaultState = {
    setupTokenId: setup.id,
    approveUrl,
    createdAt: new Date().toISOString(),
  };
  save(STATE, state);
  console.log(`Setup token ${setup.id}, status ${setup.status ?? '?'}`);
  console.log(`Approve as Harbor & Co: ${approveUrl}`);
}

async function finish(): Promise<void> {
  const state = readState();
  const setup = await step(`vault.getSetupToken ${state.setupTokenId}`, () =>
    sdk.vault.getSetupToken({ id: state.setupTokenId }),
  );
  console.log(`Setup token status: ${setup.status ?? '?'}`);
  if (setup.status !== 'APPROVED') {
    console.log('Not approved yet; open the approval link and approve as Harbor & Co.');
    return;
  }
  const token = await step('vault.createPaymentToken from the approved setup token', () =>
    sdk.vault.createPaymentToken({
      payPalRequestId: randomUUID(),
      body: { paymentSource: { token: { id: state.setupTokenId, type: 'SETUP_TOKEN' } } },
    }),
  );
  if (token.id === undefined || token.customer?.id === undefined) {
    throw new Error('Payment token response has no id or customer id');
  }
  const payerEmail = token.paymentSource?.paypal?.emailAddress ?? null;
  const done: VaultState = {
    ...state,
    paymentTokenId: token.id,
    customerId: token.customer.id,
    payerEmail,
  };
  save(STATE, done);
  save('s5-payment-token', token);
  console.log(`PASS: payment token ${token.id} for customer ${token.customer.id} (${payerEmail})`);
}

const mode = process.argv[2];
if (mode === 'start') await start();
else if (mode === 'finish') await finish();
else console.log('Usage: s5-vault-setup.ts start | finish');
