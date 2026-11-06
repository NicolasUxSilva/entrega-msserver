/**
 * API de integração contra um Postgres REAL e DESCARTÁVEL — OPT-IN.
 * Sem `INTEGRATION_TEST_DB_URL` a suíte é pulada e `pnpm test` continua offline.
 *
 *   INTEGRATION_TEST_DB_URL=postgres://…/v0_teste pnpm exec vitest run \
 *     src/server/integration/__tests__/isolation-db.test.ts
 *
 * NUNCA aponte para o banco de produção: a suíte APAGA e recria dados de teste (só nos
 * workspaces que ela mesma cria). O banco precisa estar com as migrações aplicadas.
 *
 * Prova, com SQL de verdade:
 *  - cada credencial só enxerga o próprio workspace (mesmo pedindo outro na URL);
 *  - nenhuma resposta contém token OAuth cifrado nem texto bruto de erro;
 *  - a API é SOMENTE LEITURA: as rotas rodam numa conexão com
 *    `default_transaction_read_only = on` — qualquer escrita falharia no próprio Postgres;
 *  - a paginação entrega cada linha exatamente uma vez.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { generateToken } from "../credentials";

const DB_URL = process.env.INTEGRATION_TEST_DB_URL;

vi.mock("@/server/db", async () => {
  const url = process.env.INTEGRATION_TEST_DB_URL;
  if (!url) {
    return {
      db: new Proxy({}, { get: () => { throw new Error("INTEGRATION_TEST_DB_URL ausente"); } }),
    };
  }
  const { default: pg } = await import("postgres");
  const { drizzle: make } = await import("drizzle-orm/postgres-js");
  const schemaModule = await import("@/server/db/schema");
  const client = pg(url, { prepare: false, max: 2, connection: { options: "-c default_transaction_read_only=on" } });
  return { db: make(client, { schema: schemaModule }), schema: schemaModule };
});

type Sql = import("postgres").Sql;

interface Seeded {
  ws: string;
  token: string;
  tokenId: string;
}

const MARK = "itest-integracao";
const SECRET_BYTES = "TOKEN-OAUTH-SECRETO";
const RAW_ERROR = "ERRO-BRUTO-DO-PROVEDOR invalid_grant";

async function seedWorkspace(sql: Sql, tag: "A" | "B", days: string[]): Promise<Seeded> {
  const [ws] = await sql`insert into workspaces (name) values (${`${MARK} ${tag}`}) returning id`;
  const wsId = ws!.id as string;

  const [ga4] = await sql`
    insert into connections (workspace_id, provider, status, access_token_enc, refresh_token_enc, token_expires_at, last_synced_at, last_error)
    values (${wsId}, 'ga4', ${tag === "A" ? "connected" : "error"}, ${Buffer.from(SECRET_BYTES + tag)}, ${Buffer.from(SECRET_BYTES + tag)},
            now() + interval '1 hour', now() - interval '2 hours', ${tag === "B" ? RAW_ERROR : null})
    returning id`;
  const [ads] = await sql`
    insert into connections (workspace_id, provider, status, access_token_enc, refresh_token_enc, last_synced_at)
    values (${wsId}, 'google_ads', 'connected', ${Buffer.from(SECRET_BYTES + tag)}, ${Buffer.from(SECRET_BYTES + tag)}, now() - interval '3 hours')
    returning id`;
  for (const c of [ga4!, ads!]) {
    await sql`insert into connection_properties (connection_id, external_id, display_name, currency, is_selected)
              values (${c.id}, ${`ext-${tag}-${c.id}`}, ${`Conta ${tag}`}, 'BRL', true)`;
  }
  const [run] = await sql`
    insert into sync_runs (connection_id, trigger, status, period_start, period_end, rows_in, rows_written, error, finished_at)
    values (${ga4!.id}, 'manual', 'success', ${days[0]!}, ${days.at(-1)!}, 1, 1, ${RAW_ERROR}, now())
    returning id`;

  for (const d of days) {
    for (const channel of [`${tag}-Organic Search`, `${tag}-Paid Search`]) {
      await sql`insert into fact_traffic_daily (workspace_id, connection_id, date, channel, source, medium, sessions, total_users, new_users,
                  engaged_sessions, avg_engagement_time, key_events, conversion_value, source_hash)
                values (${wsId}, ${ga4!.id}, ${d}, ${channel}, 'google', 'organic', 100, 90, 40, 60, 10, 2, 0, ${`h-${tag}-${d}-${channel}`})`;
    }
    for (const cid of [`${tag}-camp-1`, `${tag}-camp-2`]) {
      await sql`insert into fact_ad_performance_daily (workspace_id, connection_id, platform, date, campaign_id, campaign_name, campaign_status,
                  impressions, clicks, cost, conversions, conversion_value, currency, source_hash)
                values (${wsId}, ${ads!.id}, 'google_ads', ${d}, ${cid}, ${`Campanha ${cid}`}, 'ENABLED', 1000, 40, 123.45, 2, 0, 'BRL', ${`h-${tag}-${d}-${cid}`})`;
    }
  }

  await sql`insert into insights (workspace_id, sync_run_id, detector, kind, severity, title, explanation, hypothesis, evidence_json,
              period_start, period_end, confidence, confidence_basis_json, recommended_action, priority_score, dedupe_key)
            values (${wsId}, ${run!.id}, 'traffic-volume-drop', 'problem', 'critical', ${`Insight do workspace ${tag}`}, 'Explicação', 'Hipótese',
              ${sql.json({ metricLabel: "Sessões", current: 80, previous: 100, deltaPct: -0.2, format: "count" })},
              ${days[0]!}, ${days.at(-1)!}, 'alta', ${sql.json({})}, 'Ação', 1, ${`dedupe-${tag}`})`;

  const t = generateToken();
  await sql`insert into service_credentials (token_id, secret_hash, workspace_id, name, scopes, expires_at)
            values (${t.tokenId}, ${t.secretHash}, ${wsId}, ${`itest-${tag.toLowerCase()}`}, ${["marketing:read"]}, now() + interval '30 days')`;
  return { ws: wsId, token: t.token, tokenId: t.tokenId };
}

const TABLES = [
  "workspaces",
  "connections",
  "connection_properties",
  "sync_runs",
  "fact_traffic_daily",
  "fact_ad_performance_daily",
  "insights",
  "service_credentials",
] as const;

describe.skipIf(!DB_URL)("API de integração no Postgres real", () => {
  let sql: Sql;
  let A: Seeded;
  let B: Seeded;
  let routes: typeof import("../routes");
  const days: string[] = [];

  const call = async (fn: (r: Request) => Promise<Response>, path: string, token: string) => {
    const r = await fn(new Request(`http://localhost:3000/api/integration/v1/${path}`, { headers: { authorization: `Bearer ${token}` } }));
    return { status: r.status, text: await r.text() };
  };
  const counts = async () => {
    const out: Record<string, number> = {};
    for (const t of TABLES) out[t] = Number((await sql`select count(*)::int as n from ${sql(t)}`)[0]!.n);
    return out;
  };

  beforeAll(async () => {
    const { default: pg } = await import("postgres");
    sql = pg(DB_URL!, { prepare: false, max: 1 });
    await sql`delete from workspaces where name like ${MARK + "%"}`;
    const { todayInTimeZone, addDays } = await import("@/lib/dates");
    const yesterday = addDays(todayInTimeZone("America/Sao_Paulo"), -1);
    for (let i = 55; i >= 0; i--) days.push(addDays(yesterday, -i));
    A = await seedWorkspace(sql, "A", days);
    B = await seedWorkspace(sql, "B", days);
    routes = await import("../routes");
  }, 120_000);

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from workspaces where name like ${MARK + "%"}`;
    await sql.end();
  });

  it("cada credencial vê só o próprio workspace em todas as rotas", async () => {
    const before = await counts();
    for (const [me, other, tag, otherTag] of [
      [A, B, "A", "B"],
      [B, A, "B", "A"],
    ] as const) {
      const q = `?workspace_id=${other.ws}&from=${days[0]}&to=${days.at(-1)}`;
      const results = [
        await call(routes.healthGET, `health${q}`, me.token),
        await call(routes.sourcesGET, `sources${q}`, me.token),
        await call(routes.trafficGET, `traffic/daily${q}`, me.token),
        await call(routes.adCampaignsGET, `ads/campaigns/daily${q}`, me.token),
        await call(routes.diagnosticsGET, `diagnostics?workspace_id=${other.ws}`, me.token),
      ];
      for (const r of results) expect(r.status, r.text).toBe(200);
      const all = results.map((r) => r.text).join("\n");
      expect(all).not.toContain(other.ws);
      expect(all).not.toContain(`${otherTag}-Organic`);
      expect(all).not.toContain(`${otherTag}-camp-`);
      expect(all).not.toContain(`workspace ${otherTag}`);
      expect(all).toContain(`${tag}-Organic Search`);
      expect(all).toContain(`${tag}-camp-1`);
      expect(all).toContain(`Insight do workspace ${tag}`);
      expect(JSON.parse(results[0]!.text).data.workspace.id).toBe(me.ws);
    }
    // somente leitura: nada mudou em nenhuma tabela
    expect(await counts()).toEqual(before);
  });

  it("nenhuma resposta expõe token OAuth, segredo da credencial ou erro bruto", async () => {
    const bodies = [
      await call(routes.sourcesGET, "sources", B.token),
      await call(routes.trafficGET, "traffic/daily", B.token),
      await call(routes.adCampaignsGET, "ads/campaigns/daily", B.token),
      await call(routes.diagnosticsGET, "diagnostics", B.token),
      await call(routes.healthGET, "health", B.token),
    ].map((r) => r.text);
    const all = bodies.join("\n");
    expect(all).not.toContain(SECRET_BYTES);
    expect(all).not.toContain(Buffer.from(SECRET_BYTES).toString("base64").slice(0, 12));
    expect(all).not.toContain("ERRO-BRUTO");
    expect(all).not.toContain(B.token.split("_")[2]!);
    expect(all).not.toMatch(/access_token|refresh_token|secret_hash|token_id/);
    const ga4 = JSON.parse(bodies[0]!).data.find((s: { key: string }) => s.key === "ga4");
    expect(ga4.state).toBe("error");
  });

  it("valores agregados batem com o que foi gravado", async () => {
    const r = JSON.parse((await call(routes.trafficGET, `traffic/daily?from=${days[0]}&to=${days[0]}`, A.token)).text);
    expect(r.data).toEqual([
      { date: days[0], channel: "A-Organic Search", sessions: 100, engaged_sessions: 60, new_users: 40, key_events: "2.0000", conversion_value: "0.0000" },
      { date: days[0], channel: "A-Paid Search", sessions: 100, engaged_sessions: 60, new_users: 40, key_events: "2.0000", conversion_value: "0.0000" },
    ]);
    const ads = JSON.parse((await call(routes.adCampaignsGET, `ads/campaigns/daily?from=${days[0]}&to=${days[0]}`, A.token)).text);
    expect(ads.data[0]).toMatchObject({ platform: "google_ads", campaign_id: "A-camp-1", cost: "123.4500", currency: "BRL", clicks: 40 });
  });

  it("a paginação entrega cada linha uma única vez", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const qs: string = `from=${days[0]}&to=${days.at(-1)}&limit=7${cursor ? `&cursor=${cursor}` : ""}`;
      const body = JSON.parse((await call(routes.adCampaignsGET, `ads/campaigns/daily?${qs}`, A.token)).text);
      for (const row of body.data) seen.push(`${row.date}|${row.campaign_id}`);
      cursor = body.next_cursor;
      pages++;
    } while (cursor && pages < 100);
    expect(seen.length).toBe(days.length * 2);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("credencial revogada ou de outro formato é recusada", async () => {
    await sql`update service_credentials set revoked_at = now() where token_id = ${A.tokenId}`;
    expect((await call(routes.healthGET, "health", A.token)).status).toBe(401);
    await sql`update service_credentials set revoked_at = null where token_id = ${A.tokenId}`;
    expect((await call(routes.healthGET, "health", A.token)).status).toBe(200);
  });

  it("a leitura para a sincronização agendada não traz os bytes dos tokens", async () => {
    const { readConnectionsForSchedule } = await import("@/server/sync/scheduled-read");
    const rows = await readConnectionsForSchedule([A.ws]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.workspaceId === A.ws && r.hasRefreshToken === true && r.hasSelectedAccount === true)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(SECRET_BYTES);
  });
});
