/**
 * Leituras da API de integração — SOMENTE `select`, sempre escopadas pelo `workspaceId`
 * que veio da CREDENCIAL (nunca da requisição).
 *
 * O que NÃO se lê aqui, de propósito: `connections.*_token_enc`, `raw_records`,
 * `connections.last_error`, `sync_runs.error`, `users`. Nada daqui chama
 * `getValidAccessToken`, `runSync`, `runWorkspaceAnalysis` ou
 * `generateCrossSourceInsights` (todas escrevem no banco).
 */
import { and, asc, eq, gte, lte, max, ne, sql } from "drizzle-orm";

import { addDays, todayInTimeZone } from "@/lib/dates";
import type { CampaignFilters } from "@/lib/campaigns";
import { previousWindow } from "@/server/campaigns/period";
import { readCampaignDiagnostics } from "@/server/campaigns/read";
import { db } from "@/server/db";
import {
  factAdPerformanceDaily,
  factTrafficDaily,
  insights,
  serviceCredentials,
  workspaces,
} from "@/server/db/schema";
import { readSources } from "@/server/diagnostico/read";

import {
  CONVERSION_DEFINITIONS,
  type AdCampaignRow,
  type Diagnostic,
  type Source,
  type TrafficRow,
} from "./contract";
import type { StoredCredential } from "./credentials";
import {
  encodeCursor,
  fromCampaignDiagnostic,
  fromInsightRow,
  sortDiagnostics,
  toContractSource,
} from "./map";

export const TIME_ZONE = "America/Sao_Paulo";
export const today = () => todayInTimeZone(TIME_ZONE);

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

export async function findCredentialByTokenId(tokenId: string): Promise<StoredCredential | null> {
  const [row] = await db
    .select({
      id: serviceCredentials.id,
      tokenId: serviceCredentials.tokenId,
      secretHash: serviceCredentials.secretHash,
      workspaceId: serviceCredentials.workspaceId,
      name: serviceCredentials.name,
      scopes: serviceCredentials.scopes,
      expiresAt: serviceCredentials.expiresAt,
      revokedAt: serviceCredentials.revokedAt,
    })
    .from(serviceCredentials)
    .where(eq(serviceCredentials.tokenId, tokenId))
    .limit(1);
  return row ?? null;
}

export async function readWorkspace(workspaceId: string): Promise<{ id: string; name: string } | null> {
  const [row] = await db
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return row ?? null;
}

export async function readIntegrationSources(workspaceId: string, now: Date): Promise<Source[]> {
  const { sources } = await readSources(workspaceId, now);
  return sources.map(toContractSource);
}

/** GA4 por dia × canal. Paginação por chave (date, channel). */
export async function readTrafficDaily(input: {
  workspaceId: string;
  from: string;
  to: string;
  limit: number;
  after: { d: string; c: string } | null;
}): Promise<Page<TrafficRow>> {
  const t = factTrafficDaily;
  const rows = await db
    .select({
      date: t.date,
      channel: t.channel,
      sessions: sql<string>`sum(${t.sessions})::text`,
      engaged: sql<string>`sum(${t.engagedSessions})::text`,
      newUsers: sql<string>`sum(${t.newUsers})::text`,
      keyEvents: sql<string>`sum(${t.keyEvents})::numeric(20,4)::text`,
      value: sql<string>`sum(${t.conversionValue})::numeric(20,4)::text`,
    })
    .from(t)
    .where(
      and(
        eq(t.workspaceId, input.workspaceId),
        gte(t.date, input.from),
        lte(t.date, input.to),
        input.after ? sql`(${t.date}, ${t.channel}) > (${input.after.d}::date, ${input.after.c})` : undefined,
      ),
    )
    .groupBy(t.date, t.channel)
    .orderBy(asc(t.date), asc(t.channel))
    .limit(input.limit + 1);

  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return {
    data: page.map((r) => ({
      date: r.date,
      channel: r.channel === "" ? "(not set)" : r.channel,
      sessions: Number(r.sessions),
      engaged_sessions: Number(r.engaged),
      new_users: Number(r.newUsers),
      key_events: r.keyEvents,
      conversion_value: r.value,
    })),
    nextCursor: rows.length > input.limit && last ? encodeCursor({ d: last.date, c: last.channel }) : null,
  };
}

/** Mídia paga por dia × plataforma × campanha. Paginação por chave (date, platform, campaign_id). */
export async function readAdCampaignsDaily(input: {
  workspaceId: string;
  from: string;
  to: string;
  limit: number;
  after: { d: string; p: string; id: string } | null;
}): Promise<Page<AdCampaignRow>> {
  const f = factAdPerformanceDaily;
  const rows = await db
    .select({
      date: f.date,
      platform: f.platform,
      campaignId: f.campaignId,
      campaignName: max(f.campaignName),
      campaignStatus: max(f.campaignStatus),
      currency: max(f.currency),
      impressions: sql<string>`sum(${f.impressions})::text`,
      clicks: sql<string>`sum(${f.clicks})::text`,
      cost: sql<string>`sum(${f.cost})::numeric(20,4)::text`,
      conversions: sql<string>`sum(${f.conversions})::numeric(20,4)::text`,
      value: sql<string>`sum(${f.conversionValue})::numeric(20,4)::text`,
    })
    .from(f)
    .where(
      and(
        eq(f.workspaceId, input.workspaceId),
        gte(f.date, input.from),
        lte(f.date, input.to),
        input.after
          ? sql`(${f.date}, ${f.platform}, ${f.campaignId}) > (${input.after.d}::date, ${input.after.p}, ${input.after.id})`
          : undefined,
      ),
    )
    .groupBy(f.date, f.platform, f.campaignId)
    .orderBy(asc(f.date), asc(f.platform), asc(f.campaignId))
    .limit(input.limit + 1);

  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return {
    data: page.flatMap((r): AdCampaignRow[] => {
      if (r.platform !== "google_ads" && r.platform !== "meta_ads") return [];
      return [
        {
          date: r.date,
          platform: r.platform,
          campaign_id: r.campaignId,
          campaign_name: r.campaignName ?? "",
          campaign_status: r.campaignStatus ?? "",
          currency: r.currency ?? null,
          impressions: Number(r.impressions),
          clicks: Number(r.clicks),
          cost: r.cost,
          conversions: r.conversions,
          conversion_value: r.value,
          conversion_definition: CONVERSION_DEFINITIONS[r.platform],
        },
      ];
    }),
    nextCursor:
      rows.length > input.limit && last
        ? encodeCursor({ d: last.date, p: last.platform, id: last.campaignId })
        : null,
  };
}

/** Filtros da área Campanhas para "os últimos N dias até ontem, comparando com os N anteriores". */
export function campaignFiltersFor(periodDays: number, todayStr: string): CampaignFilters {
  const end = addDays(todayStr, -1);
  const current = { start: addDays(end, -(periodDays - 1)), end };
  return {
    platform: "all",
    preset: periodDays,
    current,
    previous: previousWindow(current),
    status: null,
    onlyCostWithoutResult: false,
    sort: "cost",
    page: 1,
  };
}

/**
 * Diagnósticos atuais do workspace:
 *  - motor do GA4: os insights da análise MAIS RECENTE (maior `period_end`), exceto os
 *    descartados pelo usuário;
 *  - regras de campanha: calculadas agora para os últimos `periodDays` dias (nada é gravado).
 */
export async function readIntegrationDiagnostics(input: {
  workspaceId: string;
  periodDays: number;
  now: Date;
  baseUrl: string;
}): Promise<Diagnostic[]> {
  const { workspaceId, now, baseUrl } = input;

  const [latest] = await db
    .select({ end: max(insights.periodEnd) })
    .from(insights)
    .where(eq(insights.workspaceId, workspaceId));

  const ga4Rows = latest?.end
    ? await db
        .select({
          dedupeKey: insights.dedupeKey,
          detector: insights.detector,
          kind: insights.kind,
          severity: insights.severity,
          confidence: insights.confidence,
          title: insights.title,
          explanation: insights.explanation,
          hypothesis: insights.hypothesis,
          recommendedAction: insights.recommendedAction,
          evidenceJson: insights.evidenceJson,
          periodStart: insights.periodStart,
          periodEnd: insights.periodEnd,
          updatedAt: insights.updatedAt,
        })
        .from(insights)
        .where(
          and(
            eq(insights.workspaceId, workspaceId),
            eq(insights.periodEnd, latest.end),
            ne(insights.status, "dismissed"),
          ),
        )
    : [];

  const campaign = await readCampaignDiagnostics({
    workspaceId,
    filters: campaignFiltersFor(input.periodDays, todayInTimeZone(TIME_ZONE)),
    now,
  });

  return sortDiagnostics([
    ...ga4Rows.map((r) => fromInsightRow(r, baseUrl)),
    ...campaign.map((d) => fromCampaignDiagnostic(d, baseUrl, now)),
  ]);
}
