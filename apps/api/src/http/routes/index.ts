/** Registers every route group on the API router. */
import { type Router } from 'express';
import { type Services } from '../../services.js';
import { registerClientRoutes } from './client.js';
import { registerGovernanceRoutes } from './governance.js';
import { registerOfferRoutes } from './offers.js';
import { registerPlanningRoutes } from './planning.js';
import { registerStreamRoute } from './stream.js';
import { registerSystemRoutes } from './system.js';

export function registerRoutes(router: Router, services: Services): void {
  registerSystemRoutes(router, services);
  registerGovernanceRoutes(router, services);
  registerPlanningRoutes(router, services);
  registerClientRoutes(router, services);
  registerOfferRoutes(router, services);
  registerStreamRoute(router, services);
}
