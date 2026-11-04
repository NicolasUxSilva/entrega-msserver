/**
 * Leitura das conexões para a sincronização agendada. Só colunas seguras: nunca os
 * bytes dos tokens — apenas SE existe refresh token (`is not null`).
 *
 * Duas consultas simples (conexões + contas escolhidas), como em `diagnostico/read.ts`:
 * uma subconsulta correlacionada em `sql\`\`` sairia com colunas sem qualificação de
 * tabela no Drizzle e compararia a coluna errada.
 */
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/server/db";
import { connectionProperties, connections } from "@/server/db/schema";

import type { ConnectionForSchedule } from "./scheduled";

export async function readConnectionsForSchedule(workspaceIds: string[]): Promise<ConnectionForSchedule[]> {
  if (workspaceIds.length === 0) return [];
  const conns = await db
    .select({
      id: connections.id,
      workspaceId: connections.workspaceId,
      provider: connections.provider,
      status: connections.status,
      hasRefreshToken: sql<boolean>`${connections.refreshTokenEnc} is not null`,
      tokenExpiresAt: connections.tokenExpiresAt,
      lastSyncedAt: connections.lastSyncedAt,
    })
    .from(connections)
    .where(inArray(connections.workspaceId, workspaceIds));
  if (conns.length === 0) return [];

  const selected = await db
    .select({ connectionId: connectionProperties.connectionId })
    .from(connectionProperties)
    .where(
      and(
        inArray(
          connectionProperties.connectionId,
          conns.map((c) => c.id),
        ),
        eq(connectionProperties.isSelected, true),
      ),
    );
  const withAccount = new Set(selected.map((s) => s.connectionId));
  return conns.map((c) => ({ ...c, hasSelectedAccount: withAccount.has(c.id) }));
}
