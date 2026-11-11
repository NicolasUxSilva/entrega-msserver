/**
 * Trava contra importações simultâneas da MESMA conexão (cron × botão "Importar", dois
 * cliques, duas instâncias do cron).
 *
 * Como funciona — sem migração e sem tabela nova:
 *  1. numa transação CURTA, `SELECT … FOR UPDATE` na linha de `connections`: quem chega
 *     depois espera essa transação terminar (milissegundos), então a decisão é serial;
 *  2. se já existe um `sync_runs` `running` dessa conexão iniciado há menos de
 *     `RUNNING_LEASE_MINUTES`, a nova importação NÃO começa;
 *  3. senão, cria o `sync_runs` `running` e encerra a transação — a importação em si roda
 *     fora dela (não segura conexão nem trava durante minutos; funciona também com o
 *     pooler do Neon em modo transação).
 *
 * Um `running` mais antigo que a janela é tratado como abandonado (a função morreu no
 * meio): não bloqueia para sempre. A janela (15 min) é bem maior que o `maxDuration`
 * das funções (300 s), então uma importação viva nunca é considerada abandonada.
 * Nenhuma linha existente é alterada aqui.
 */
import { and, eq, gt, sql } from "drizzle-orm";

import { db } from "@/server/db";
import { connections, syncRuns } from "@/server/db/schema";

import { RUNNING_LEASE_MINUTES } from "./lease";

export { RUNNING_LEASE_MINUTES };

export type ClaimResult = { claimed: true; runId: string } | { claimed: false; runningSince: Date };

export async function claimSyncRun(input: {
  connectionId: string;
  trigger: "manual" | "initial";
  periodStart: string;
  periodEnd: string;
}): Promise<ClaimResult> {
  return db.transaction(async (tx) => {
    await tx
      .select({ id: connections.id })
      .from(connections)
      .where(eq(connections.id, input.connectionId))
      .for("update");

    const [running] = await tx
      .select({ startedAt: syncRuns.startedAt })
      .from(syncRuns)
      .where(
        and(
          eq(syncRuns.connectionId, input.connectionId),
          eq(syncRuns.status, "running"),
          gt(syncRuns.startedAt, sql`now() - make_interval(mins => ${RUNNING_LEASE_MINUTES})`),
        ),
      )
      .limit(1);
    if (running) return { claimed: false as const, runningSince: running.startedAt };

    const [run] = await tx
      .insert(syncRuns)
      .values({
        connectionId: input.connectionId,
        trigger: input.trigger,
        status: "running",
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
      })
      .returning({ id: syncRuns.id });
    if (!run) throw new Error("Falha ao criar sync_run.");
    return { claimed: true as const, runId: run.id };
  });
}
