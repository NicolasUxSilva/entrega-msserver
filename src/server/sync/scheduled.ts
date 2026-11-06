/**
 * Sincronização AGENDADA (diária) das conexões dos workspaces autorizados.
 *
 * Disparada por `GET /api/cron/sync` (Vercel Cron, protegida por `CRON_SECRET`). Usa o
 * MESMO `runSync` do botão "Importar" — nada de caminho paralelo de importação.
 *
 * Antes de importar, confere o estado OAuth de cada conexão e PULA (com motivo) as que
 * não podem funcionar: desconectada/erro, sem conta escolhida, ou token vencido de um
 * provedor sem refresh token (Meta). Pular não altera o estado da conexão: quem decide
 * "precisa reconectar" continua sendo o fluxo normal do token.
 *
 * Só roda para os workspaces listados em `SCHEDULED_SYNC_WORKSPACE_IDS` (o cadastro é
 * aberto: sem a lista, ninguém é sincronizado automaticamente).
 *
 * Orçamento de tempo: as conexões são processadas uma a uma, da importação mais antiga
 * para a mais recente; quando o tempo restante não comporta outra importação, para — a
 * próxima execução continua de onde as mais antigas ficaram.
 */
const SCHEDULED_PROVIDERS = ["ga4", "google_ads", "meta_ads", "rd_station_marketing", "rd_station_crm"] as const;

export interface ConnectionForSchedule {
  id: string;
  workspaceId: string;
  provider: string;
  status: "connected" | "reauth_required" | "error";
  hasSelectedAccount: boolean;
  hasRefreshToken: boolean;
  tokenExpiresAt: Date | null;
  lastSyncedAt: Date | null;
}

export type SkipReason =
  | "workspace_not_scheduled"
  | "provider_not_scheduled"
  | "needs_reauth"
  | "connection_error"
  | "no_account_selected"
  | "token_expired_without_refresh";

export function planScheduledSync(input: {
  connections: ConnectionForSchedule[];
  allowedWorkspaces: ReadonlySet<string>;
  now: Date;
}): { eligible: ConnectionForSchedule[]; skipped: { id: string; provider: string; reason: SkipReason }[] } {
  const eligible: ConnectionForSchedule[] = [];
  const skipped: { id: string; provider: string; reason: SkipReason }[] = [];
  for (const c of input.connections) {
    const skip = (reason: SkipReason) => skipped.push({ id: c.id, provider: c.provider, reason });
    if (!input.allowedWorkspaces.has(c.workspaceId)) skip("workspace_not_scheduled");
    else if (!(SCHEDULED_PROVIDERS as readonly string[]).includes(c.provider)) skip("provider_not_scheduled");
    else if (c.status === "reauth_required") skip("needs_reauth");
    else if (c.status === "error") skip("connection_error");
    else if (!c.hasSelectedAccount) skip("no_account_selected");
    else if (c.tokenExpiresAt && c.tokenExpiresAt <= input.now && !c.hasRefreshToken) skip("token_expired_without_refresh");
    else eligible.push(c);
  }
  // nunca importadas primeiro; depois da importação mais antiga para a mais recente
  eligible.sort((a, b) => (a.lastSyncedAt?.getTime() ?? 0) - (b.lastSyncedAt?.getTime() ?? 0) || a.id.localeCompare(b.id));
  return { eligible, skipped };
}

export function parseWorkspaceList(raw: string | undefined): Set<string> {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return new Set(
    (raw ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => re.test(s)),
  );
}

export interface ScheduledRunResult {
  provider: string;
  connectionId: string;
  outcome: "success" | "partial" | "failed" | "error" | "deferred";
  rowsWritten: number | null;
}

export async function runScheduledSync(input: {
  plan: ReturnType<typeof planScheduledSync>;
  budgetMs: number;
  /** tempo reservado para uma importação: abaixo disso não começa outra */
  perSyncReserveMs: number;
  clock: () => number;
  runSync: (connectionId: string) => Promise<{ status: "success" | "partial" | "failed"; rowsWritten: number }>;
}): Promise<{ results: ScheduledRunResult[]; skipped: ReturnType<typeof planScheduledSync>["skipped"] }> {
  const start = input.clock();
  const results: ScheduledRunResult[] = [];
  for (const c of input.plan.eligible) {
    const remaining = input.budgetMs - (input.clock() - start);
    if (remaining < input.perSyncReserveMs) {
      results.push({ provider: c.provider, connectionId: c.id, outcome: "deferred", rowsWritten: null });
      continue;
    }
    try {
      const r = await input.runSync(c.id);
      results.push({ provider: c.provider, connectionId: c.id, outcome: r.status, rowsWritten: r.rowsWritten });
    } catch {
      // a mensagem do provedor fica no sync_run/connection (fluxo normal); aqui só o resultado
      results.push({ provider: c.provider, connectionId: c.id, outcome: "error", rowsWritten: null });
    }
  }
  return { results, skipped: input.plan.skipped };
}
