/** Registers every route group on the API router. */
import { type Router } from 'express';
import { type Services } from '../../services.js';
import { registerGovernanceRoutes } from './governance.js';
import { registerStreamRoute } from './stream.js';
import { registerSystemRoutes } from './system.js';

export function registerRoutes(router: Router, services: Services): void {
  registerSystemRoutes(router, services);
  registerGovernanceRoutes(router, services);
  registerStreamRoute(router, services);
}
