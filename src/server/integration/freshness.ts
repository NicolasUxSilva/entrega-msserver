/**
 * Atualidade dos dados de uma fonte — função PURA (sem banco).
 *
 * Responde, para a Gestão, sem que ela precise deduzir nada:
 *  - `unavailable`: não há dados utilizáveis (fonte não conectada, sem conta, nunca
 *    importada, importada sem dados ou sem nenhuma importação bem-sucedida);
 *  - `stale`: há dados, mas a fonte deixou de atualizar — última importação bem-sucedida
 *    há mais de `STALE_AFTER_HOURS`, última tentativa falhou, ou a conexão precisa de
 *    atenção (reconectar / erro), o que impede as próximas importações;
 *  - `incomplete`: atualizada, mas a última importação terminou `partial` (teto de linhas
 *    ou detalhe de grupos/anúncios que falhou);
 *  - `fresh`: atualizada e completa.
 * `reasons` lista TODOS os motivos encontrados (o `status` é o mais grave).
 *
 * Ausência de dado nunca vira zero: `data_through`/`data_lag_days` são `null` sem dados.
 */
// mesma janela da trava de concorrência (`src/server/sync/lock.ts`)
import { RUNNING_LEASE_MINUTES } from "@/server/sync/lease";

import type { FRESHNESS_REASONS, FRESHNESS_STATUSES, Source } from "./contract";

/** A sincronização agendada é diária: 24 h + 12 h de folga para atraso e nova tentativa. */
export const STALE_AFTER_HOURS = 36;
export { RUNNING_LEASE_MINUTES };

export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];
export type FreshnessReason = (typeof FRESHNESS_REASONS)[number];

export interface LastAttempt {
  status: "running" | "success" | "partial" | "failed";
  startedAt: Date;
  finishedAt: Date | null;
}

export interface Freshness {
  status: FreshnessStatus;
  reasons: FreshnessReason[];
  last_successful_sync_at: string | null;
  hours_since_success: number | null;
  stale_after_hours: number;
  last_attempt: { status: LastAttempt["status"]; started_at: string; finished_at: string | null } | null;
  data_through: string | null;
  data_lag_days: number | null;
}

const UNAVAILABLE_STATES: Partial<Record<Source["state"], FreshnessReason>> = {
  not_connected: "not_connected",
  no_account: "no_account",
  never_synced: "never_synced",
  no_data: "no_data",
};

function daysBetween(fromIsoDate: string, toIsoDate: string): number {
  const ms = Date.parse(`${toIsoDate}T00:00:00Z`) - Date.parse(`${fromIsoDate}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function computeFreshness(input: {
  state: Source["state"];
  lastSuccessAt: Date | null;
  lastAttempt: LastAttempt | null;
  /** status da última importação TERMINADA (success | partial | failed) */
  lastFinishedStatus: "success" | "partial" | "failed" | null;
  coverage: { first: string; last: string } | null;
  now: Date;
  today: string;
}): Freshness {
  const reasons: FreshnessReason[] = [];
  const unavailable = UNAVAILABLE_STATES[input.state];
  if (unavailable) reasons.push(unavailable);
  if (!input.lastSuccessAt && !unavailable) reasons.push("no_successful_sync");

  const hours =
    input.lastSuccessAt === null
      ? null
      : Math.max(0, Math.floor(((input.now.getTime() - input.lastSuccessAt.getTime()) / 3_600_000) * 10) / 10);

  if (input.state === "needs_reauth" || input.state === "error") reasons.push("connection_needs_attention");
  if (input.state === "sync_failed" || input.lastFinishedStatus === "failed") reasons.push("last_sync_failed");
  if (hours !== null && hours > STALE_AFTER_HOURS) reasons.push("sync_overdue");
  if (input.lastFinishedStatus === "partial") reasons.push("last_sync_partial");
  if (
    input.lastAttempt?.status === "running" &&
    input.now.getTime() - input.lastAttempt.startedAt.getTime() < RUNNING_LEASE_MINUTES * 60_000
  ) {
    reasons.push("sync_running");
  }

  if (!unavailable && input.lastSuccessAt && !input.coverage) reasons.push("no_data");

  const unique = [...new Set(reasons)];
  const status: FreshnessStatus =
    unavailable || !input.lastSuccessAt || !input.coverage
      ? "unavailable"
      : unique.some((r) => r === "connection_needs_attention" || r === "last_sync_failed" || r === "sync_overdue")
        ? "stale"
        : unique.includes("last_sync_partial")
          ? "incomplete"
          : "fresh";

  return {
    status,
    reasons: unique,
    last_successful_sync_at: input.lastSuccessAt ? input.lastSuccessAt.toISOString() : null,
    hours_since_success: hours,
    stale_after_hours: STALE_AFTER_HOURS,
    last_attempt: input.lastAttempt
      ? {
          status: input.lastAttempt.status,
          started_at: input.lastAttempt.startedAt.toISOString(),
          finished_at: input.lastAttempt.finishedAt ? input.lastAttempt.finishedAt.toISOString() : null,
        }
      : null,
    data_through: input.coverage?.last ?? null,
    data_lag_days: input.coverage ? Math.max(0, daysBetween(input.coverage.last, input.today)) : null,
  };
}
