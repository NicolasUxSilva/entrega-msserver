/**
 * Ligação das rotas reais: handlers + leituras do banco + dependências de produção.
 * Cada arquivo `src/app/api/integration/v1/<rota>/route.ts` só reexporta o GET daqui.
 */
import { env } from "@/env";

import {
  adCampaignsResponse,
  diagnosticsResponse,
  healthResponse,
  sourcesResponse,
  trafficResponse,
} from "./contract";
import { buildHandlers } from "./handlers";
import { RateLimiter, createIntegrationRoute, type IntegrationDeps } from "./http";
import {
  findCredentialByTokenId,
  readAdCampaignsDaily,
  readIntegrationDiagnostics,
  readIntegrationSources,
  readTrafficDaily,
  readWorkspace,
  today,
} from "./read";

const deps: IntegrationDeps = {
  findByTokenId: findCredentialByTokenId,
  now: () => new Date(),
  log: (entry) => console.info(JSON.stringify(entry)),
  limiter: new RateLimiter(),
};

const handlers = buildHandlers({
  today,
  baseUrl: env.AUTH_URL,
  readWorkspace,
  readSources: readIntegrationSources,
  readTraffic: readTrafficDaily,
  readAdCampaigns: readAdCampaignsDaily,
  readDiagnostics: readIntegrationDiagnostics,
});

const SCOPE = "marketing:read" as const;

export const healthGET = createIntegrationRoute({ scope: SCOPE, response: healthResponse, handler: handlers.health, deps });
export const sourcesGET = createIntegrationRoute({ scope: SCOPE, response: sourcesResponse, handler: handlers.sources, deps });
export const trafficGET = createIntegrationRoute({ scope: SCOPE, response: trafficResponse, handler: handlers.traffic, deps });
export const adCampaignsGET = createIntegrationRoute({
  scope: SCOPE,
  response: adCampaignsResponse,
  handler: handlers.adCampaigns,
  deps,
});
export const diagnosticsGET = createIntegrationRoute({
  scope: SCOPE,
  response: diagnosticsResponse,
  handler: handlers.diagnostics,
  deps,
});
