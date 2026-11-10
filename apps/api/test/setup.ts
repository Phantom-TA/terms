/** Runs in every test file: lets background work started by a test finish before the next test. */
import { afterEach } from 'vitest';
import { settleApps } from './helpers/app.js';

afterEach(async () => {
  await settleApps();
});
