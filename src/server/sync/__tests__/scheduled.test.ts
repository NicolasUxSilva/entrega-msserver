import { describe, expect, it } from "vitest";

import { checkCronAuth } from "../cron-auth";
import {
  parseWorkspaceList,
  planScheduledSync,
  runScheduledSync,
  type ConnectionForSchedule,
} from "../scheduled";

const WS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = new Date("2026-11-04T09:00:00Z");

const conn = (over: Partial<ConnectionForSchedule>): ConnectionForSchedule => ({
  id: "c",
  workspaceId: WS,
  provider: "ga4",
  status: "connected",
  hasSelectedAccount: true,
  hasRefreshToken: true,
  tokenExpiresAt: new Date("2026-11-04T10:00:00Z"),
  lastSyncedAt: new Date("2026-11-03T09:00:00Z"),
  ...over,
});

describe("planScheduledSync — confere o estado OAuth antes de importar", () => {
  it("pula com motivo o que não pode funcionar", () => {
    const plan = planScheduledSync({
      allowedWorkspaces: new Set([WS]),
      now: NOW,
      connections: [
        conn({ id: "ok" }),
        conn({ id: "outro-ws", workspaceId: OTHER }),
        conn({ id: "morto", provider: "rd_station" }),
        conn({ id: "reauth", status: "reauth_required" }),
        conn({ id: "erro", status: "error" }),
        conn({ id: "sem-conta", hasSelectedAccount: false }),
        conn({ id: "meta-vencido", provider: "meta_ads", hasRefreshToken: false, tokenExpiresAt: new Date("2026-11-01T00:00:00Z") }),
        conn({ id: "google-vencido-com-refresh", tokenExpiresAt: new Date("2026-11-01T00:00:00Z") }),
      ],
    });
    expect(plan.eligible.map((c) => c.id).sort()).toEqual(["google-vencido-com-refresh", "ok"]);
    expect(Object.fromEntries(plan.skipped.map((s) => [s.id, s.reason]))).toEqual({
      "outro-ws": "workspace_not_scheduled",
      morto: "provider_not_scheduled",
      reauth: "needs_reauth",
      erro: "connection_error",
      "sem-conta": "no_account_selected",
      "meta-vencido": "token_expired_without_refresh",
    });
  });

  it("sem lista de workspaces, ninguém é sincronizado", () => {
    const plan = planScheduledSync({ allowedWorkspaces: parseWorkspaceList(undefined), now: NOW, connections: [conn({})] });
    expect(plan.eligible).toEqual([]);
  });

  it("nunca importadas primeiro, depois da mais antiga para a mais recente", () => {
    const plan = planScheduledSync({
      allowedWorkspaces: new Set([WS]),
      now: NOW,
      connections: [
        conn({ id: "recente", lastSyncedAt: new Date("2026-11-03T00:00:00Z") }),
        conn({ id: "nunca", lastSyncedAt: null }),
        conn({ id: "antiga", lastSyncedAt: new Date("2026-10-01T00:00:00Z") }),
      ],
    });
    expect(plan.eligible.map((c) => c.id)).toEqual(["nunca", "antiga", "recente"]);
  });

  it("lista de workspaces ignora valores que não são uuid", () => {
    expect(parseWorkspaceList(` ${WS.toUpperCase()} , lixo, ,${OTHER}`)).toEqual(new Set([WS, OTHER]));
  });
});

describe("runScheduledSync", () => {
  it("uma falha não interrompe as demais e o orçamento adia o que não cabe", async () => {
    let t = 0;
    const plan = planScheduledSync({
      allowedWorkspaces: new Set([WS]),
      now: NOW,
      connections: [conn({ id: "1", lastSyncedAt: null }), conn({ id: "2", lastSyncedAt: new Date(1) }), conn({ id: "3", lastSyncedAt: new Date(2) })],
    });
    const out = await runScheduledSync({
      plan,
      budgetMs: 100_000,
      perSyncReserveMs: 40_000,
      clock: () => t,
      runSync: async (id) => {
        t += 40_000;
        if (id === "1") throw new Error("invalid_grant token=SEGREDO");
        return { status: "success", rowsWritten: 5 };
      },
    });
    expect(out.results.map((r) => [r.connectionId, r.outcome])).toEqual([
      ["1", "error"],
      ["2", "success"],
      ["3", "deferred"],
    ]);
    expect(JSON.stringify(out)).not.toContain("SEGREDO");
  });
});

describe("checkCronAuth", () => {
  const secret = "s".repeat(40);
  it("desligada sem segredo; exige o Bearer exato", () => {
    expect(checkCronAuth(`Bearer ${secret}`, undefined)).toBe("disabled");
    expect(checkCronAuth(`Bearer ${secret}`, secret)).toBe("ok");
    expect(checkCronAuth(`Bearer ${secret}x`, secret)).toBe("unauthorized");
    expect(checkCronAuth(null, secret)).toBe("unauthorized");
    expect(checkCronAuth(secret, secret)).toBe("unauthorized");
  });
});
