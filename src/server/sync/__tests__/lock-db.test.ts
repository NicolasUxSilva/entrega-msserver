/**
 * Trava de importação (`../lock`) e regra de usuários existentes do login contra um
 * Postgres REAL e DESCARTÁVEL — OPT-IN (mesma variável da suíte de integração).
 * Sem `INTEGRATION_TEST_DB_URL` a suíte é pulada e `pnpm test` continua offline.
 *
 *   INTEGRATION_TEST_DB_URL=postgres://…/v0_teste pnpm exec vitest run \
 *     src/server/sync/__tests__/lock-db.test.ts
 *
 * NUNCA aponte para o banco de produção: a suíte cria e APAGA os próprios dados (só os
 * workspaces/usuários marcados com `itest-lock`). Precisa das migrações aplicadas.
 * Nenhum conector externo é chamado: os testes param antes de qualquer importação real.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DB_URL = process.env.INTEGRATION_TEST_DB_URL;

vi.mock("@/server/db", async () => {
  const url = process.env.INTEGRATION_TEST_DB_URL;
  if (!url) {
    return { db: new Proxy({}, { get: () => { throw new Error("INTEGRATION_TEST_DB_URL ausente"); } }) };
  }
  const { default: pg } = await import("postgres");
  const { drizzle: make } = await import("drizzle-orm/postgres-js");
  const schemaModule = await import("@/server/db/schema");
  // conexões suficientes para as tentativas simultâneas competirem de verdade
  const client = pg(url, { prepare: false, max: 8 });
  return { db: make(client, { schema: schemaModule }), schema: schemaModule };
});

// nenhum conector pode ser chamado nestes testes
vi.mock("@/server/connectors/registry", () => ({
  getConnector: () => ({
    meta: { restatementWindowDays: 3 },
    streams: [{ id: "x" }],
    pull: () => {
      throw new Error("conector externo NÃO deveria ser chamado");
    },
    mapToCanonical: () => ({ rows: [] }),
  }),
}));

type Sql = import("postgres").Sql;
const MARK = "itest-lock";

describe.skipIf(!DB_URL)("trava de importação e login no Postgres real", () => {
  let sql: Sql;
  let connId: string;
  let otherConnId: string;

  const runningCount = async (id: string) =>
    Number((await sql`select count(*)::int n from sync_runs where connection_id = ${id} and status = 'running'`)[0]!.n);

  beforeAll(async () => {
    const { default: pg } = await import("postgres");
    sql = pg(DB_URL!, { prepare: false, max: 1 });
    await sql`delete from workspaces where name like ${MARK + "%"}`;
    await sql`delete from users where email like ${MARK + "%"}`;
    const [ws] = await sql`insert into workspaces (name) values (${`${MARK} W`}) returning id`;
    const mk = async (provider: string) => {
      const [c] = await sql`
        insert into connections (workspace_id, provider, status, access_token_enc, refresh_token_enc, token_expires_at)
        values (${ws!.id}, ${provider}, 'connected', ${Buffer.from("x")}, ${Buffer.from("x")}, now() + interval '1 hour')
        returning id`;
      await sql`insert into connection_properties (connection_id, external_id, display_name, timezone, is_selected)
                values (${c!.id}, ${`ext-${provider}`}, 'Conta', 'America/Sao_Paulo', true)`;
      return c!.id as string;
    };
    connId = await mk("ga4");
    otherConnId = await mk("google_ads");
  }, 60_000);

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from workspaces where name like ${MARK + "%"}`;
    await sql`delete from users where email like ${MARK + "%"}`;
    await sql.end();
  });

  it("tentativas simultâneas da mesma conexão: exatamente uma começa", async () => {
    const { claimSyncRun } = await import("../lock");
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        claimSyncRun({ connectionId: connId, trigger: "manual", periodStart: "2026-11-01", periodEnd: "2026-11-06" }),
      ),
    );
    expect(attempts.filter((a) => a.claimed)).toHaveLength(1);
    expect(attempts.filter((a) => !a.claimed)).toHaveLength(7);
    expect(await runningCount(connId)).toBe(1);
  });

  it("a trava é por conexão: outra fonte do mesmo workspace não espera", async () => {
    const { claimSyncRun } = await import("../lock");
    const r = await claimSyncRun({ connectionId: otherConnId, trigger: "manual", periodStart: "2026-11-01", periodEnd: "2026-11-06" });
    expect(r.claimed).toBe(true);
    await sql`update sync_runs set status = 'success', finished_at = now() where connection_id = ${otherConnId}`;
  });

  it("runSync com importação em andamento devolve alreadyRunning e não toca em nada", async () => {
    const { runSync } = await import("../run-sync");
    const snapshot = async () => ({
      runs: (await sql`select id, status, started_at, finished_at from sync_runs where connection_id = ${connId} order by id`).map((r) => ({ ...r })),
      raw: Number((await sql`select count(*)::int n from raw_records where connection_id = ${connId}`)[0]!.n),
      conn: { ...(await sql`select status, last_synced_at, last_error from connections where id = ${connId}`)[0] },
    });
    const before = await snapshot();
    const r = await runSync({ connectionId: connId });
    expect(r).toMatchObject({ alreadyRunning: true, status: "failed", rowsWritten: 0, syncRunId: "" });
    expect(r.error).toMatch(/importação em andamento/);
    expect(await snapshot()).toEqual(before);
  });

  it("um running abandonado (mais antigo que a janela) não bloqueia para sempre", async () => {
    const { claimSyncRun, RUNNING_LEASE_MINUTES } = await import("../lock");
    await sql`update sync_runs set started_at = now() - make_interval(mins => ${RUNNING_LEASE_MINUTES + 1})
              where connection_id = ${connId} and status = 'running'`;
    const r = await claimSyncRun({ connectionId: connId, trigger: "manual", periodStart: "2026-11-01", periodEnd: "2026-11-06" });
    expect(r.claimed).toBe(true);
    // o abandonado continua como estava (a trava não reescreve histórico)
    expect(await runningCount(connId)).toBe(2);
  });

  it("depois que a importação termina, a próxima pode começar", async () => {
    const { claimSyncRun } = await import("../lock");
    await sql`update sync_runs set status = 'success', finished_at = now() where connection_id = ${connId} and status = 'running'`;
    const r = await claimSyncRun({ connectionId: connId, trigger: "manual", periodStart: "2026-11-01", periodEnd: "2026-11-06" });
    expect(r.claimed).toBe(true);
  });

  it("login: usuário existente é reconhecido sem diferenciar maiúsculas; novo não", async () => {
    const { userExistsByEmail } = await import("@/server/auth/provision");
    await sql`insert into users (email, name) values (${`${MARK}-antigo@Exemplo.com`}, 'Antigo')`;
    expect(await userExistsByEmail(`${MARK}-ANTIGO@exemplo.com`)).toBe(true);
    expect(await userExistsByEmail(`  ${MARK}-antigo@exemplo.com `)).toBe(true);
    expect(await userExistsByEmail(`${MARK}-novo@exemplo.com`)).toBe(false);

    // ponta a ponta da regra: existente entra mesmo em produção sem lista; novo não
    const { decideSignIn, parseList } = await import("@/server/auth/allowlist");
    const cfg = { emails: parseList(""), domains: parseList(""), production: true };
    const decide = async (email: string) =>
      decideSignIn({ email, emailVerified: true, existingUser: await userExistsByEmail(email) }, cfg);
    expect(await decide(`${MARK}-antigo@exemplo.com`)).toEqual({ allowed: true, reason: "existing_user" });
    expect(await decide(`${MARK}-novo@exemplo.com`)).toEqual({ allowed: false, reason: "signup_closed" });
  });
});
