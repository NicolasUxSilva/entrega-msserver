/**
 * Conversões PURAS do modelo interno para o contrato v1 (`./contract`) e leitura dos
 * parâmetros de consulta. Nada aqui toca o banco.
 *
 * Princípios:
 *  - nunca repassar texto bruto de erro de provedor (`connections.last_error`,
 *    `sync_runs.error`): a mensagem da fonte sai de um dicionário fechado por estado;
 *  - vocabulários unificados: o motor do GA4 usa `critical|attention` e `alta|media`;
 *    as regras de campanha usam `high|medium|low|info` — o contrato só fala o segundo.
 */
import { z } from "zod";

import { addDays } from "@/lib/dates";
import type { CampaignDiagnostic } from "@/lib/campaign-diagnostics";
import type { SourceStatus } from "@/lib/insight";

import type { Diagnostic, Source } from "./contract";
import { computeFreshness, type LastAttempt } from "./freshness";

// ── fontes ────────────────────────────────────────────────────────────

const STATE_MESSAGES: Record<Source["state"], string> = {
  not_connected: "Fonte não conectada no V0-saas.",
  needs_reauth: "O acesso à fonte expirou ou foi revogado: é preciso reconectar no V0-saas.",
  error: "A conexão com a fonte está com erro no V0-saas.",
  no_account: "Fonte conectada, mas sem conta ou propriedade escolhida.",
  sync_failed: "A última importação falhou: os dados podem estar desatualizados.",
  never_synced: "Fonte conectada, mas ainda sem importação.",
  no_data: "Importação feita, mas sem dados.",
  synced: "Dados importados.",
};

/** Histórico de importação de uma fonte, para o cálculo de atualidade. */
export interface SourceRunHistory {
  lastAttempt: LastAttempt | null;
  lastFinishedStatus: "success" | "partial" | "failed" | null;
}

export function toContractSource(
  s: SourceStatus,
  history: SourceRunHistory = { lastAttempt: null, lastFinishedStatus: null },
  clock: { now: Date; today: string } = { now: new Date(), today: new Date().toISOString().slice(0, 10) },
): Source {
  const coverage = s.coverage ? { first: s.coverage.first, last: s.coverage.last } : null;
  const lastSuccessAt = s.lastSyncedAt ? new Date(s.lastSyncedAt) : null;
  return {
    key: s.key,
    label: s.label,
    state: s.health,
    message: STATE_MESSAGES[s.health],
    last_synced_at: lastSuccessAt ? lastSuccessAt.toISOString() : null,
    coverage,
    freshness: computeFreshness({
      state: s.health,
      lastSuccessAt,
      lastAttempt: history.lastAttempt,
      lastFinishedStatus: history.lastFinishedStatus,
      coverage,
      now: clock.now,
      today: clock.today,
    }),
  };
}

// ── diagnósticos: regras de campanha ──────────────────────────────────

function absoluteLink(href: string | null, baseUrl: string): string | null {
  if (!href || !href.startsWith("/")) return null;
  return new URL(href, baseUrl).toString();
}

export function fromCampaignDiagnostic(d: CampaignDiagnostic, baseUrl: string, generatedAt: Date): Diagnostic {
  const e = d.entity;
  const hasEntity = Boolean(e.campaignId || e.adGroupId || e.adId);
  return {
    id: `camp:${d.id}`,
    origin: "campaign_rules",
    kind: d.kind,
    severity: d.severity,
    confidence: d.confidence,
    platform: d.platform,
    level: d.level,
    entity: hasEntity
      ? {
          campaign_id: e.campaignId,
          campaign_name: e.campaignName,
          ad_group_id: e.adGroupId,
          ad_group_name: e.adGroupName,
          ad_id: e.adId,
          ad_name: e.adName,
        }
      : null,
    title: d.title,
    description: d.description,
    hypothesis: null,
    recommendation: d.nextCheck,
    limitation: d.limitation,
    evidence: d.evidence.map((m) => ({
      metric: m.key,
      label: m.label,
      current: finiteOrNull(m.current),
      previous: finiteOrNull(m.previous),
      delta_pct: finiteOrNull(m.deltaPct),
      format: m.format,
    })),
    currency: d.currency,
    period: {
      start: d.period.current.start,
      end: d.period.current.end,
      previous_start: d.period.previous?.start ?? null,
      previous_end: d.period.previous?.end ?? null,
    },
    link: absoluteLink(e.href, baseUrl),
    generated_at: generatedAt.toISOString(),
  };
}

// ── diagnósticos: motor do GA4 (tabela `insights`) ────────────────────

export interface InsightRowForApi {
  dedupeKey: string;
  detector: string;
  kind: "problem" | "opportunity" | "data_quality";
  severity: "critical" | "attention";
  confidence: "alta" | "media";
  title: string;
  explanation: string;
  hypothesis: string;
  recommendedAction: string;
  evidenceJson: unknown;
  periodStart: string;
  periodEnd: string;
  updatedAt: Date;
}

const insightEvidence = z.object({
  metricLabel: z.string(),
  current: z.number(),
  previous: z.number(),
  deltaPct: z.number(),
  format: z.string(),
});

const KIND: Record<InsightRowForApi["kind"], Diagnostic["kind"]> = {
  problem: "finding",
  opportunity: "opportunity",
  data_quality: "limitation",
};
const SEVERITY: Record<InsightRowForApi["severity"], Diagnostic["severity"]> = {
  critical: "high",
  attention: "medium",
};
const CONFIDENCE: Record<InsightRowForApi["confidence"], Diagnostic["confidence"]> = {
  alta: "high",
  media: "medium",
};

export function fromInsightRow(r: InsightRowForApi, baseUrl: string): Diagnostic {
  const ev = insightEvidence.safeParse(r.evidenceJson);
  return {
    id: `ga4:${r.dedupeKey}`,
    origin: "ga4_engine",
    kind: KIND[r.kind],
    severity: SEVERITY[r.severity],
    confidence: CONFIDENCE[r.confidence],
    platform: "ga4",
    level: "property",
    entity: null,
    title: r.title,
    description: r.explanation,
    hypothesis: r.hypothesis || null,
    recommendation: r.recommendedAction,
    limitation: r.kind === "data_quality" ? r.explanation : null,
    evidence: ev.success
      ? [
          {
            metric: r.detector,
            label: ev.data.metricLabel,
            current: finiteOrNull(ev.data.current),
            previous: finiteOrNull(ev.data.previous),
            delta_pct: finiteOrNull(ev.data.deltaPct),
            format: ev.data.format,
          },
        ]
      : [],
    currency: null,
    period: { start: r.periodStart, end: r.periodEnd, previous_start: null, previous_end: null },
    link: new URL("/diagnostico", baseUrl).toString(),
    generated_at: r.updatedAt.toISOString(),
  };
}

const SEVERITY_RANK: Record<Diagnostic["severity"], number> = { high: 0, medium: 1, low: 2, info: 3 };
const KIND_RANK: Record<Diagnostic["kind"], number> = { finding: 0, opportunity: 1, inconclusive: 2, limitation: 3 };

/** Ordem estável para o cliente: natureza, gravidade, origem, id. */
export function sortDiagnostics(items: Diagnostic[]): Diagnostic[] {
  return [...items].sort(
    (a, b) =>
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.origin.localeCompare(b.origin) ||
      a.id.localeCompare(b.id),
  );
}

function finiteOrNull(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// ── parâmetros ────────────────────────────────────────────────────────

export const MAX_RANGE_DAYS = 366;
export const DEFAULT_RANGE_DAYS = 90;
export const DEFAULT_PAGE_SIZE = 1000;
export const MAX_PAGE_SIZE = 5000;
export const DIAGNOSTIC_PERIODS = [7, 14, 28, 30, 90] as const;

export class ParamError extends Error {}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function validDate(v: string): boolean {
  if (!ISO_DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;
}

/** `from`/`to` (inclusivos). Sem eles: os últimos `DEFAULT_RANGE_DAYS` dias até ontem. */
export function parseRange(params: URLSearchParams, today: string): { from: string; to: string } {
  const from = params.get("from");
  const to = params.get("to");
  if (from === null && to === null) {
    const end = addDays(today, -1);
    return { from: addDays(end, -(DEFAULT_RANGE_DAYS - 1)), to: end };
  }
  if (from === null || to === null) throw new ParamError("Informe `from` e `to` juntos (YYYY-MM-DD).");
  if (!validDate(from) || !validDate(to)) throw new ParamError("`from` e `to` devem ser datas YYYY-MM-DD válidas.");
  if (from > to) throw new ParamError("`from` não pode ser posterior a `to`.");
  if (to > today) throw new ParamError("`to` não pode ser posterior a hoje.");
  if (daysBetween(from, to) > MAX_RANGE_DAYS) throw new ParamError(`O intervalo máximo é de ${MAX_RANGE_DAYS} dias.`);
  return { from, to };
}

export function parseLimit(params: URLSearchParams): number {
  const raw = params.get("limit");
  if (raw === null) return DEFAULT_PAGE_SIZE;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PAGE_SIZE) throw new ParamError(`\`limit\` deve ser um inteiro entre 1 e ${MAX_PAGE_SIZE}.`);
  return n;
}

export function parseDiagnosticPeriod(params: URLSearchParams): number {
  const raw = params.get("period_days");
  if (raw === null) return 28;
  const n = Number(raw);
  if (!(DIAGNOSTIC_PERIODS as readonly number[]).includes(n)) {
    throw new ParamError(`\`period_days\` deve ser um de: ${DIAGNOSTIC_PERIODS.join(", ")}.`);
  }
  return n;
}

/** Cursor opaco (base64url de JSON). Cursor adulterado → erro de parâmetro, nunca exceção. */
export function encodeCursor(key: Record<string, string>): string {
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64url");
}
export function decodeCursor<K extends string>(raw: string | null, keys: readonly K[]): Record<K, string> | null {
  if (raw === null) return null;
  try {
    const obj: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof obj !== "object" || obj === null) throw new Error();
    const out = {} as Record<K, string>;
    for (const k of keys) {
      const v = (obj as Record<string, unknown>)[k];
      if (typeof v !== "string" || v.length > 500) throw new Error();
      out[k] = v;
    }
    return out;
  } catch {
    throw new ParamError("`cursor` inválido.");
  }
}
