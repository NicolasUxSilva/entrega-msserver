/**
 * Handlers dos endpoints da v1. O workspace vem SEMPRE de `ctx.client.workspaceId`
 * (a credencial); nenhum parâmetro de consulta escolhe workspace.
 *
 * `IntegrationReads` é injetável: os testes de contrato/rota usam leituras falsas e as
 * rotas reais usam `./read`.
 */
import type { AdCampaignRow, Diagnostic, Source, TrafficRow } from "./contract";
import type { IntegrationHandler } from "./http";
import { decodeCursor, parseDiagnosticPeriod, parseLimit, parseRange } from "./map";
import type { Page } from "./read";

export interface IntegrationReads {
  today: () => string;
  baseUrl: string;
  readWorkspace: (workspaceId: string) => Promise<{ id: string; name: string } | null>;
  readSources: (workspaceId: string, now: Date) => Promise<Source[]>;
  readTraffic: (input: {
    workspaceId: string;
    from: string;
    to: string;
    limit: number;
    after: { d: string; c: string } | null;
  }) => Promise<Page<TrafficRow>>;
  readAdCampaigns: (input: {
    workspaceId: string;
    from: string;
    to: string;
    limit: number;
    after: { d: string; p: string; id: string } | null;
  }) => Promise<Page<AdCampaignRow>>;
  readDiagnostics: (input: {
    workspaceId: string;
    periodDays: number;
    now: Date;
    baseUrl: string;
  }) => Promise<Diagnostic[]>;
}

export function buildHandlers(reads: IntegrationReads): Record<
  "health" | "sources" | "traffic" | "adCampaigns" | "diagnostics",
  IntegrationHandler
> {
  return {
    async health({ client }) {
      const ws = await reads.readWorkspace(client.workspaceId);
      if (!ws) throw new Error("workspace da credencial não existe");
      return {
        data: {
          status: "ok",
          workspace: ws,
          credential: { name: client.name, scopes: client.scopes, expires_at: client.expiresAt.toISOString() },
        },
      };
    },

    async sources({ client, now }) {
      return { data: await reads.readSources(client.workspaceId, now) };
    },

    async traffic({ client, params }) {
      const { from, to } = parseRange(params, reads.today());
      const limit = parseLimit(params);
      const after = decodeCursor(params.get("cursor"), ["d", "c"] as const);
      const page = await reads.readTraffic({ workspaceId: client.workspaceId, from, to, limit, after });
      return { data: page.data, nextCursor: page.nextCursor };
    },

    async adCampaigns({ client, params }) {
      const { from, to } = parseRange(params, reads.today());
      const limit = parseLimit(params);
      const after = decodeCursor(params.get("cursor"), ["d", "p", "id"] as const);
      const page = await reads.readAdCampaigns({ workspaceId: client.workspaceId, from, to, limit, after });
      return { data: page.data, nextCursor: page.nextCursor };
    },

    async diagnostics({ client, params, now }) {
      const periodDays = parseDiagnosticPeriod(params);
      return {
        data: await reads.readDiagnostics({ workspaceId: client.workspaceId, periodDays, now, baseUrl: reads.baseUrl }),
      };
    },
  };
}
