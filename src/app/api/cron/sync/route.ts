/**
 * Sincronização diária agendada (Vercel Cron → vercel.json). Ver src/server/sync/scheduled.ts.
 * Responde só contagens e resultados por conexão — nenhum dado de marketing, nenhum erro bruto.
 */
import { env } from "@/env";
import { DATABASE_RETRY_AFTER_SECONDS, isDatabaseUnavailable } from "@/server/db/unavailable";
import { checkCronAuth } from "@/server/sync/cron-auth";
import { parseWorkspaceList, planScheduledSync, runScheduledSync } from "@/server/sync/scheduled";
import { readConnectionsForSchedule } from "@/server/sync/scheduled-read";
import { runSync } from "@/server/sync/run-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** limite da função na Vercel (Pro: até 300 s; Hobby: 60 s — o orçamento abaixo se ajusta) */
export const maxDuration = 300;

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...extra },
  });

export async function GET(request: Request): Promise<Response> {
  const auth = checkCronAuth(request.headers.get("authorization"), env.CRON_SECRET);
  if (auth === "disabled") return json(503, { error: { code: "cron_disabled", message: "CRON_SECRET não configurado." } });
  if (auth === "unauthorized") return json(401, { error: { code: "unauthorized", message: "Não autorizado." } });

  const allowed = parseWorkspaceList(env.SCHEDULED_SYNC_WORKSPACE_IDS);
  let connections: Awaited<ReturnType<typeof readConnectionsForSchedule>>;
  try {
    connections = await readConnectionsForSchedule([...allowed]);
  } catch (err) {
    // sem repassar a mensagem original (pode conter host/usuário do banco)
    const unavailable = isDatabaseUnavailable(err);
    console.info(JSON.stringify({ event: "scheduled_sync", status: unavailable ? 503 : 500 }));
    return unavailable
      ? json(503, { error: { code: "database_unavailable", message: "Banco de dados temporariamente indisponível." } }, {
          "retry-after": String(DATABASE_RETRY_AFTER_SECONDS),
        })
      : json(500, { error: { code: "internal_error", message: "Erro interno." } });
  }
  const plan = planScheduledSync({ connections, allowedWorkspaces: allowed, now: new Date() });
  const out = await runScheduledSync({
    plan,
    budgetMs: (env.SCHEDULED_SYNC_BUDGET_SECONDS ?? 270) * 1000,
    perSyncReserveMs: 60_000,
    clock: () => Date.now(),
    runSync: async (connectionId) => {
      const r = await runSync({ connectionId });
      return { status: r.status, rowsWritten: r.rowsWritten, ...(r.alreadyRunning ? { alreadyRunning: true as const } : {}) };
    },
  });
  console.info(
    JSON.stringify({
      event: "scheduled_sync",
      results: out.results.map((r) => ({ provider: r.provider, outcome: r.outcome })),
      skipped: out.skipped.map((s) => ({ provider: s.provider, reason: s.reason })),
    }),
  );
  return json(200, out);
}
