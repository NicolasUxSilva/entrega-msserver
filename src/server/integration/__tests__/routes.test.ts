/**
 * Rotas da API de integração com leituras FALSAS (sem banco): autenticação, escopo,
 * limite, parâmetros, contrato da resposta e — principalmente — que o workspace usado
 * nas leituras é sempre o da credencial.
 */
import { describe, expect, it, vi } from "vitest";

import {
  adCampaignsResponse,
  diagnosticsResponse,
  healthResponse,
  sourcesResponse,
  trafficResponse,
} from "../contract";
import { generateToken, hashSecret, parseToken, type StoredCredential } from "../credentials";
import { buildHandlers, type IntegrationReads } from "../handlers";
import { RateLimiter, createIntegrationRoute, type IntegrationDeps } from "../http";

const WS_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WS_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = new Date("2026-11-04T12:00:00Z");

function credFor(workspaceId: string, scopes = ["marketing:read"]) {
  const t = generateToken();
  const p = parseToken(t.token)!;
  const cred: StoredCredential = {
    id: `cred-${workspaceId.slice(0, 4)}`,
    tokenId: p.tokenId,
    secretHash: hashSecret(p.secret),
    workspaceId,
    name: "gestao-msserver",
    scopes,
    expiresAt: new Date("2027-01-01T00:00:00Z"),
    revokedAt: null,
  };
  return { token: t.token, cred };
}

function fakeReads(seen: string[]): IntegrationReads {
  const remember = (ws: string) => {
    seen.push(ws);
  };
  return {
    today: () => "2026-11-04",
    baseUrl: "https://v0.example.com",
    readWorkspace: async (ws) => (remember(ws), { id: ws, name: `Workspace ${ws.slice(0, 4)}` }),
    readSources: async (ws) => (
      remember(ws),
      [
        {
          key: "ga4",
          label: "Google Analytics 4",
          state: "synced",
          message: "Dados importados.",
          last_synced_at: "2026-11-04T09:00:00.000Z",
          coverage: { first: "2026-05-01", last: "2026-11-03" },
          freshness: {
            status: "fresh",
            reasons: [],
            last_successful_sync_at: "2026-11-04T09:00:00.000Z",
            hours_since_success: 3,
            stale_after_hours: 36,
            last_attempt: {
              status: "success",
              started_at: "2026-11-04T08:58:00.000Z",
              finished_at: "2026-11-04T09:00:00.000Z",
            },
            data_through: "2026-11-03",
            data_lag_days: 1,
          },
        },
      ]
    ),
    readTraffic: async ({ workspaceId, limit }) => (
      remember(workspaceId),
      {
        data: [
          { date: "2026-11-01", channel: "Organic Search", sessions: 120, engaged_sessions: 80, new_users: 70, key_events: "4.0000", conversion_value: "0.0000" },
        ].slice(0, limit),
        nextCursor: null,
      }
    ),
    readAdCampaigns: async ({ workspaceId }) => (
      remember(workspaceId),
      {
        data: [
          {
            date: "2026-11-01",
            platform: "google_ads",
            campaign_id: "123",
            campaign_name: "Busca Marca",
            campaign_status: "ENABLED",
            currency: "BRL",
            impressions: 1000,
            clicks: 50,
            cost: "150.2500",
            conversions: "3.0000",
            conversion_value: "0.0000",
            conversion_definition: "google_ads.metrics.conversions",
          },
        ],
        nextCursor: "abc",
      }
    ),
    readDiagnostics: async ({ workspaceId }) => (remember(workspaceId), []),
  };
}

function setup(opts: { reads?: IntegrationReads; limiter?: RateLimiter; creds?: StoredCredential[] } = {}) {
  const seen: string[] = [];
  const reads = opts.reads ?? fakeReads(seen);
  const a = credFor(WS_A);
  const b = credFor(WS_B);
  const creds = opts.creds ?? [a.cred, b.cred];
  const logs: Record<string, unknown>[] = [];
  const deps: IntegrationDeps = {
    findByTokenId: async (id) => creds.find((c) => c.tokenId === id) ?? null,
    now: () => NOW,
    log: (e) => logs.push(e),
    limiter: opts.limiter ?? new RateLimiter(),
  };
  const h = buildHandlers(reads);
  const route = (handler: keyof typeof h, response: Parameters<typeof createIntegrationRoute>[0]["response"]) =>
    createIntegrationRoute({ scope: "marketing:read", response, handler: h[handler], deps });
  return {
    seen,
    logs,
    a,
    b,
    health: route("health", healthResponse),
    sources: route("sources", sourcesResponse),
    traffic: route("traffic", trafficResponse),
    ads: route("adCampaigns", adCampaignsResponse),
    diagnostics: route("diagnostics", diagnosticsResponse),
  };
}

const req = (path: string, token?: string) =>
  new Request(`https://v0.example.com/api/integration/v1/${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

describe("autenticação nas rotas", () => {
  it("401 com WWW-Authenticate sem credencial; nenhuma leitura acontece", async () => {
    const s = setup();
    for (const route of [s.health, s.sources, s.traffic, s.ads, s.diagnostics]) {
      const r = await route(req("x"));
      expect(r.status).toBe(401);
      expect(r.headers.get("www-authenticate")).toBe("Bearer");
      expect(await r.json()).toEqual({ error: { code: "missing_token", message: expect.any(String) } });
    }
    expect(s.seen).toEqual([]);
  });

  it("403 sem escopo", async () => {
    const c = credFor(WS_A, ["outro:escopo"]);
    const s = setup({ creds: [c.cred] });
    const r = await s.sources(req("sources", c.token));
    expect(r.status).toBe(403);
    expect(s.seen).toEqual([]);
  });

  it("o log de acesso não contém o token nem o segredo", async () => {
    const s = setup();
    await s.sources(req("sources", s.a.token));
    await s.sources(req("sources", "v0s_0123456789abcdef_" + "x".repeat(43)));
    const all = JSON.stringify(s.logs);
    expect(all).not.toContain(s.a.token);
    expect(all).not.toContain(s.a.token.split("_")[2]!);
    expect(all).toContain(s.a.cred.tokenId);
  });
});

describe("isolamento de workspace", () => {
  it("cada credencial lê só o próprio workspace, mesmo pedindo outro na URL", async () => {
    const s = setup();
    await s.traffic(req(`traffic/daily?workspace_id=${WS_B}&workspaceId=${WS_B}`, s.a.token));
    await s.ads(req(`ads/campaigns/daily?workspace=${WS_B}`, s.a.token));
    await s.diagnostics(req(`diagnostics?workspace_id=${WS_B}`, s.a.token));
    await s.sources(req(`sources?workspace_id=${WS_B}`, s.a.token));
    expect(new Set(s.seen)).toEqual(new Set([WS_A]));

    s.seen.length = 0;
    await s.health(req("health", s.b.token));
    expect(s.seen).toEqual([WS_B]);
  });
});

describe("contrato das respostas", () => {
  it("todas as rotas respondem no envelope v1, com no-store e versão no cabeçalho", async () => {
    const s = setup();
    const cases = [
      [s.health, healthResponse],
      [s.sources, sourcesResponse],
      [s.traffic, trafficResponse],
      [s.ads, adCampaignsResponse],
      [s.diagnostics, diagnosticsResponse],
    ] as const;
    for (const [route, schema] of cases) {
      const r = await route(req("x", s.a.token));
      expect(r.status).toBe(200);
      expect(r.headers.get("cache-control")).toBe("no-store");
      expect(r.headers.get("x-contract-version")).toBe("1.0");
      const body = await r.json();
      expect(schema.safeParse(body).success).toBe(true);
      expect(body.server_time).toBe(NOW.toISOString());
    }
  });

  it("repassa o cursor da página seguinte", async () => {
    const s = setup();
    const body = await (await s.ads(req("ads/campaigns/daily", s.a.token))).json();
    expect(body.next_cursor).toBe("abc");
  });

  it("resposta fora do contrato vira 500 e nada é entregue pela metade", async () => {
    const seen: string[] = [];
    const reads = fakeReads(seen);
    reads.readTraffic = async () => ({
      data: [{ date: "2026-11-01", channel: "x", sessions: 1.5, engaged_sessions: 0, new_users: 0, key_events: "x", conversion_value: "0" }] as never,
      nextCursor: null,
    });
    const s = setup({ reads });
    const r = await s.traffic(req("traffic/daily", s.a.token));
    expect(r.status).toBe(500);
    const body = await r.json();
    expect(body.error.code).toBe("internal_error");
    expect(JSON.stringify(body)).not.toContain("1.5");
    expect(s.logs.at(-1)).toMatchObject({ code: "contract_violation" });
  });

  it("erro inesperado vira 500 genérico, sem detalhes internos", async () => {
    const reads = fakeReads([]);
    reads.readSources = async () => {
      throw new Error("connect ECONNREFUSED 10.0.0.5:5432 password=xyz");
    };
    const s = setup({ reads });
    const r = await s.sources(req("sources", s.a.token));
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain("ECONNREFUSED");
  });

  it("banco indisponível nas leituras vira 503 database_unavailable com Retry-After, sem detalhes", async () => {
    const reads = fakeReads([]);
    reads.readTraffic = async () => {
      const driver = Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432 user=neondb_owner"), { code: "ECONNREFUSED" });
      throw new Error("Failed query: select … from fact_traffic_daily", { cause: driver });
    };
    const s = setup({ reads });
    const r = await s.traffic(req("traffic/daily", s.a.token));
    expect(r.status).toBe(503);
    expect(r.headers.get("retry-after")).toBe("30");
    expect(r.headers.get("cache-control")).toBe("no-store");
    const text = await r.text();
    expect(JSON.parse(text)).toEqual({
      error: {
        code: "database_unavailable",
        message: "Banco de dados temporariamente indisponível. Tente de novo em instantes; nenhum dado foi alterado.",
      },
    });
    expect(text).not.toMatch(/ECONNREFUSED|10\.0\.0\.5|neondb|fact_traffic|select/);
    expect(s.logs.at(-1)).toMatchObject({ status: 503, code: "database_unavailable" });
  });

  it("banco indisponível ao validar a credencial também vira 503 JSON (nunca erro cru)", async () => {
    const reads = fakeReads([]);
    const s = setup({ reads });
    const failing = createIntegrationRoute({
      scope: "marketing:read",
      response: healthResponse,
      handler: async () => ({ data: null }),
      deps: {
        findByTokenId: async () => {
          throw Object.assign(new Error("terminating connection due to administrator command"), { code: "57P01" });
        },
        now: () => NOW,
        log: () => {},
        limiter: new RateLimiter(),
      },
    });
    const r = await failing(req("health", s.a.token));
    expect(r.status).toBe(503);
    expect((await r.json()).error.code).toBe("database_unavailable");
  });

  it("falha não relacionada ao banco ao validar a credencial vira 500 JSON", async () => {
    const s = setup();
    const failing = createIntegrationRoute({
      scope: "marketing:read",
      response: healthResponse,
      handler: async () => ({ data: null }),
      deps: {
        findByTokenId: async () => {
          throw new Error("bug inesperado com detalhe interno");
        },
        now: () => NOW,
        log: () => {},
        limiter: new RateLimiter(),
      },
    });
    const r = await failing(req("health", s.a.token));
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain("detalhe interno");
  });
});

describe("parâmetros e limites", () => {
  it("400 com mensagem clara para parâmetro inválido", async () => {
    const s = setup();
    const r = await s.traffic(req("traffic/daily?from=2026-10-31&to=2026-10-01", s.a.token));
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe("invalid_params");
    const r2 = await s.diagnostics(req("diagnostics?period_days=3", s.a.token));
    expect(r2.status).toBe(400);
  });

  it("429 ao passar do limite por credencial (sem afetar outra credencial)", async () => {
    const s = setup({ limiter: new RateLimiter(2, 60_000) });
    expect((await s.sources(req("sources", s.a.token))).status).toBe(200);
    expect((await s.sources(req("sources", s.a.token))).status).toBe(200);
    const blocked = await s.sources(req("sources", s.a.token));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
    expect((await s.sources(req("sources", s.b.token))).status).toBe(200);
  });

  it("só GET é exportado pelas rotas (os demais métodos ficam 405 no Next)", async () => {
    const mod = await import("@/app/api/integration/v1/sources/route");
    expect(Object.keys(mod).filter((k) => /^(GET|POST|PUT|PATCH|DELETE)$/.test(k))).toEqual(["GET"]);
  });
});

vi.mock("@/server/integration/routes", () => ({
  healthGET: () => new Response(),
  sourcesGET: () => new Response(),
  trafficGET: () => new Response(),
  adCampaignsGET: () => new Response(),
  diagnosticsGET: () => new Response(),
}));
