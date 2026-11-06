/**
 * Contrato da API de integração — versão 1 (`/api/integration/v1`).
 *
 * Fonte da verdade do formato das respostas. As rotas validam a própria saída contra
 * estes schemas antes de responder (uma resposta fora do contrato vira 500, nunca um
 * payload malformado para o cliente) e os testes de contrato usam os mesmos schemas.
 * Documentação para quem consome: docs/integracao-gestao-v1.md.
 *
 * Regras de compatibilidade da v1:
 *  - campo NOVO e opcional pode entrar sem mudar a versão (o cliente deve ignorar o que
 *    não conhece);
 *  - remover/renomear campo, mudar tipo ou significado → `/api/integration/v2`, que
 *    convive com a v1 até o cliente migrar.
 *
 * Convenções: datas `YYYY-MM-DD` (dia no fuso da conta/propriedade de origem);
 * instantes ISO-8601 UTC; dinheiro e quantidades fracionárias como TEXTO decimal
 * (`"1234.5600"`) — nunca float; contagens inteiras como número.
 */
import { z } from "zod";

export const CONTRACT_VERSION = "1.0";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoInstant = z.string().datetime({ offset: true });
const decimal = z.string().regex(/^-?\d+(\.\d+)?$/);
const count = z.number().int().nonnegative();

export function envelope<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    contract_version: z.literal(CONTRACT_VERSION),
    server_time: isoInstant,
    data,
    next_cursor: z.string().nullable(),
  });
}

export const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

// ── /health ───────────────────────────────────────────────────────────

export const healthSchema = z.object({
  status: z.literal("ok"),
  workspace: z.object({ id: z.string().uuid(), name: z.string() }),
  credential: z.object({ name: z.string(), scopes: z.array(z.string()), expires_at: isoInstant }),
});

// ── /sources ──────────────────────────────────────────────────────────

export const SOURCE_KEYS = ["ga4", "google_ads", "meta_ads", "rd_station_marketing", "rd_station_crm"] as const;
export const SOURCE_STATES = [
  "not_connected",
  "needs_reauth",
  "error",
  "no_account",
  "sync_failed",
  "never_synced",
  "no_data",
  "synced",
] as const;

export const FRESHNESS_STATUSES = ["fresh", "stale", "incomplete", "unavailable"] as const;
export const FRESHNESS_REASONS = [
  "not_connected",
  "no_account",
  "never_synced",
  "no_data",
  "no_successful_sync",
  "connection_needs_attention",
  "last_sync_failed",
  "last_sync_partial",
  "sync_overdue",
  "sync_running",
] as const;

export const sourceSchema = z.object({
  key: z.enum(SOURCE_KEYS),
  label: z.string(),
  /** estado da fonte; só `synced` significa "há dados importados e a conexão está ok" */
  state: z.enum(SOURCE_STATES),
  /** frase curta em pt-BR, gerada a partir do estado — nunca o texto bruto de erro do provedor */
  message: z.string(),
  last_synced_at: isoInstant.nullable(),
  /** período dos dados já importados; `null` = nenhum dado */
  coverage: z.object({ first: isoDate, last: isoDate }).nullable(),
  /**
   * Atualidade dos dados (campo ADITIVO da v1 — ver `./freshness`). `status`:
   * `fresh` | `stale` | `incomplete` | `unavailable`; `reasons` traz todos os motivos.
   */
  freshness: z.object({
    status: z.enum(FRESHNESS_STATUSES),
    reasons: z.array(z.enum(FRESHNESS_REASONS)),
    /** última importação bem-sucedida (inclui `partial`); igual a `last_synced_at` */
    last_successful_sync_at: isoInstant.nullable(),
    hours_since_success: z.number().nonnegative().nullable(),
    stale_after_hours: z.number().int().positive(),
    last_attempt: z
      .object({
        status: z.enum(["running", "success", "partial", "failed"]),
        started_at: isoInstant,
        finished_at: isoInstant.nullable(),
      })
      .nullable(),
    /** último dia com dados importados; `null` = nenhum dado (nunca zero) */
    data_through: isoDate.nullable(),
    /** dias entre `data_through` e hoje (America/Sao_Paulo); `null` sem dados */
    data_lag_days: count.nullable(),
  }),
});

// ── /traffic/daily (GA4) ──────────────────────────────────────────────

export const trafficRowSchema = z.object({
  date: isoDate,
  /** sessionDefaultChannelGroup do GA4 ("Organic Search", "Paid Search"…) */
  channel: z.string(),
  sessions: count,
  engaged_sessions: count,
  /** novos usuários — somável entre dias e canais */
  new_users: count,
  key_events: decimal,
  conversion_value: decimal,
});

// ── /ads/campaigns/daily ──────────────────────────────────────────────

export const AD_PLATFORMS = ["google_ads", "meta_ads"] as const;

/**
 * O que a coluna `conversions` conta em cada plataforma. As definições são DIFERENTES:
 * conversões de plataformas distintas não devem ser somadas.
 */
export const CONVERSION_DEFINITIONS = {
  google_ads: "google_ads.metrics.conversions",
  meta_ads: "meta_ads.actions:lead+purchase+complete_registration",
} as const;

export const adCampaignRowSchema = z.object({
  date: isoDate,
  platform: z.enum(AD_PLATFORMS),
  campaign_id: z.string(),
  campaign_name: z.string(),
  campaign_status: z.string(),
  /** moeda da conta (ISO-4217); `cost` e `conversion_value` estão nela, sem conversão cambial */
  currency: z.string().nullable(),
  impressions: count,
  clicks: count,
  cost: decimal,
  conversions: decimal,
  conversion_value: decimal,
  conversion_definition: z.string(),
});

// ── /diagnostics ──────────────────────────────────────────────────────

export const DIAGNOSTIC_ORIGINS = ["ga4_engine", "campaign_rules"] as const;
export const DIAGNOSTIC_KINDS = ["finding", "opportunity", "inconclusive", "limitation"] as const;
export const DIAGNOSTIC_SEVERITIES = ["high", "medium", "low", "info"] as const;
export const DIAGNOSTIC_CONFIDENCES = ["high", "medium", "low"] as const;

export const diagnosticSchema = z.object({
  /** estável entre chamadas enquanto o diagnóstico continuar valendo */
  id: z.string(),
  origin: z.enum(DIAGNOSTIC_ORIGINS),
  kind: z.enum(DIAGNOSTIC_KINDS),
  severity: z.enum(DIAGNOSTIC_SEVERITIES),
  confidence: z.enum(DIAGNOSTIC_CONFIDENCES),
  platform: z.enum(["ga4", "google_ads", "meta_ads"]),
  level: z.enum(["property", "platform", "campaign", "ad_group", "ad"]),
  entity: z
    .object({
      campaign_id: z.string().nullable(),
      campaign_name: z.string().nullable(),
      ad_group_id: z.string().nullable(),
      ad_group_name: z.string().nullable(),
      ad_id: z.string().nullable(),
      ad_name: z.string().nullable(),
    })
    .nullable(),
  title: z.string(),
  description: z.string(),
  /** o porquê provável (só no motor do GA4) */
  hypothesis: z.string().nullable(),
  /** o que fazer / verificar a seguir */
  recommendation: z.string(),
  /** por que a conclusão é limitada; `null` = nada a ressalvar */
  limitation: z.string().nullable(),
  evidence: z.array(
    z.object({
      metric: z.string(),
      label: z.string(),
      current: z.number().nullable(),
      previous: z.number().nullable(),
      delta_pct: z.number().nullable(),
      format: z.string(),
    }),
  ),
  currency: z.string().nullable(),
  period: z.object({
    start: isoDate,
    end: isoDate,
    previous_start: isoDate.nullable(),
    previous_end: isoDate.nullable(),
  }),
  /** página do V0-saas com o detalhe (exige login no V0-saas); `null` = não há */
  link: z.string().url().nullable(),
  generated_at: isoInstant,
});

export const healthResponse = envelope(healthSchema);
export const sourcesResponse = envelope(z.array(sourceSchema));
export const trafficResponse = envelope(z.array(trafficRowSchema));
export const adCampaignsResponse = envelope(z.array(adCampaignRowSchema));
export const diagnosticsResponse = envelope(z.array(diagnosticSchema));

export type Source = z.infer<typeof sourceSchema>;
export type TrafficRow = z.infer<typeof trafficRowSchema>;
export type AdCampaignRow = z.infer<typeof adCampaignRowSchema>;
export type Diagnostic = z.infer<typeof diagnosticSchema>;
export type Health = z.infer<typeof healthSchema>;
