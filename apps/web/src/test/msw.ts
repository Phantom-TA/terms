import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { resetWorld } from '../mocks/handlers';
import { server } from '../mocks/server';

/**
 * Registers the mock API for a test file. Every test starts from a fresh demo scenario, signed
 * in as `businessId` (the owner by default).
 */
export function installMockApi(businessId: string | null = 'biz_maya'): void {
  beforeAll(() => {
    server.listen({ onUnhandledFrame: 'error' });
  });
  beforeEach(() => {
    sessionStorage.clear();
    if (businessId) sessionStorage.setItem('terms.mock.session', businessId);
    resetWorld();
  });
  afterEach(() => {
    server.resetHandlers();
  });
  afterAll(() => {
    server.close();
  });
}
