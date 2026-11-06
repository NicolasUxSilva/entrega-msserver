import { describe, expect, it } from "vitest";

import { isDatabaseUnavailable } from "@/server/db/unavailable";

import { FRESHNESS_REASONS, sourceSchema } from "../contract";
import { STALE_AFTER_HOURS, computeFreshness } from "../freshness";
import { toContractSource } from "../map";

const NOW = new Date("2026-11-06T12:00:00Z");
const TODAY = "2026-11-06";
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const COVERAGE = { first: "2026-05-10", last: "2026-11-05" };

const base = {
  state: "synced" as const,
  lastSuccessAt: hoursAgo(3),
  lastAttempt: { status: "success" as const, startedAt: hoursAgo(3.1), finishedAt: hoursAgo(3) },
  lastFinishedStatus: "success" as const,
  coverage: COVERAGE,
  now: NOW,
  today: TODAY,
};

describe("computeFreshness", () => {
  it("fresh: importação recente e completa", () => {
    const f = computeFreshness(base);
    expect(f).toMatchObject({
      status: "fresh",
      reasons: [],
      last_successful_sync_at: hoursAgo(3).toISOString(),
      hours_since_success: 3,
      stale_after_hours: STALE_AFTER_HOURS,
      data_through: "2026-11-05",
      data_lag_days: 1,
    });
  });

  it("stale: a fonte deixou de sincronizar (passou do limite)", () => {
    const f = computeFreshness({ ...base, lastSuccessAt: hoursAgo(STALE_AFTER_HOURS + 1) });
    expect(f.status).toBe("stale");
    expect(f.reasons).toEqual(["sync_overdue"]);
  });

  it("no limite exato ainda não é stale", () => {
    expect(computeFreshness({ ...base, lastSuccessAt: hoursAgo(STALE_AFTER_HOURS) }).status).toBe("fresh");
  });

  it("stale: última tentativa falhou, mesmo com sucesso recente antes dela", () => {
    const f = computeFreshness({
      ...base,
      state: "sync_failed",
      lastAttempt: { status: "failed", startedAt: hoursAgo(1), finishedAt: hoursAgo(1) },
      lastFinishedStatus: "failed",
    });
    expect(f.status).toBe("stale");
    expect(f.reasons).toContain("last_sync_failed");
    expect(f.last_attempt).toEqual({ status: "failed", started_at: hoursAgo(1).toISOString(), finished_at: hoursAgo(1).toISOString() });
  });

  it("stale: conexão precisa ser refeita (as próximas importações não vão acontecer)", () => {
    for (const state of ["needs_reauth", "error"] as const) {
      const f = computeFreshness({ ...base, state });
      expect(f.status).toBe("stale");
      expect(f.reasons).toContain("connection_needs_attention");
    }
  });

  it("incomplete: última importação terminou partial", () => {
    const f = computeFreshness({ ...base, lastFinishedStatus: "partial" });
    expect(f.status).toBe("incomplete");
    expect(f.reasons).toEqual(["last_sync_partial"]);
  });

  it("stale prevalece sobre incomplete, mas os dois motivos aparecem", () => {
    const f = computeFreshness({ ...base, lastFinishedStatus: "partial", lastSuccessAt: hoursAgo(80) });
    expect(f.status).toBe("stale");
    expect(f.reasons).toEqual(["sync_overdue", "last_sync_partial"]);
  });

  it("unavailable: sem dados nunca vira zero nem 'atualizado'", () => {
    for (const state of ["not_connected", "no_account", "never_synced", "no_data"] as const) {
      const f = computeFreshness({ ...base, state, lastSuccessAt: null, lastAttempt: null, lastFinishedStatus: null, coverage: null });
      expect(f).toMatchObject({
        status: "unavailable",
        reasons: [state],
        last_successful_sync_at: null,
        hours_since_success: null,
        data_through: null,
        data_lag_days: null,
        last_attempt: null,
      });
    }
  });

  it("unavailable: conectada, tentou e nunca teve sucesso", () => {
    const f = computeFreshness({
      ...base,
      state: "sync_failed",
      lastSuccessAt: null,
      coverage: null,
      lastAttempt: { status: "failed", startedAt: hoursAgo(2), finishedAt: hoursAgo(2) },
      lastFinishedStatus: "failed",
    });
    expect(f.status).toBe("unavailable");
    expect(f.reasons).toEqual(["no_successful_sync", "last_sync_failed"]);
  });

  it("sync_running só enquanto a importação está dentro da janela; abandonada não conta", () => {
    const running = computeFreshness({ ...base, lastAttempt: { status: "running", startedAt: hoursAgo(0.1), finishedAt: null } });
    expect(running.status).toBe("fresh");
    expect(running.reasons).toEqual(["sync_running"]);
    const abandoned = computeFreshness({ ...base, lastAttempt: { status: "running", startedAt: hoursAgo(2), finishedAt: null } });
    expect(abandoned.reasons).toEqual([]);
  });

  it("todos os motivos possíveis estão no contrato", () => {
    const f = computeFreshness({ ...base, state: "needs_reauth", lastSuccessAt: hoursAgo(100), lastFinishedStatus: "partial" });
    for (const r of f.reasons) expect(FRESHNESS_REASONS).toContain(r);
  });
});

describe("toContractSource com freshness", () => {
  it("monta uma fonte válida pelo contrato", () => {
    const s = toContractSource(
      {
        key: "google_ads",
        label: "Google Ads",
        health: "synced",
        summary: "",
        notice: null,
        action: null,
        lastSyncedAt: hoursAgo(50).toISOString(),
        coverage: COVERAGE,
        feeds: "",
      },
      { lastAttempt: { status: "success", startedAt: hoursAgo(50), finishedAt: hoursAgo(50) }, lastFinishedStatus: "success" },
      { now: NOW, today: TODAY },
    );
    expect(sourceSchema.parse(s)).toBeTruthy();
    expect(s.state).toBe("synced");
    expect(s.freshness.status).toBe("stale");
    expect(s.last_synced_at).toBe(s.freshness.last_successful_sync_at);
  });
});

describe("isDatabaseUnavailable", () => {
  const withCode = (code: string) => Object.assign(new Error("x"), { code });
  it("reconhece rede, driver e SQLSTATE de conexão, inclusive embrulhados em cause", () => {
    for (const code of ["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "CONNECT_TIMEOUT", "CONNECTION_CLOSED", "08006", "08001", "57P01", "57P03", "53300"]) {
      expect(isDatabaseUnavailable(withCode(code)), code).toBe(true);
      expect(isDatabaseUnavailable(new Error("drizzle", { cause: withCode(code) })), `cause ${code}`).toBe(true);
    }
    expect(isDatabaseUnavailable(new AggregateError([withCode("ECONNREFUSED")]))).toBe(true);
  });
  it("não confunde erro de SQL, de restrição ou genérico com indisponibilidade", () => {
    for (const code of ["42P01", "23505", "22P02", "XX000"]) expect(isDatabaseUnavailable(withCode(code)), code).toBe(false);
    expect(isDatabaseUnavailable(new Error("connect ECONNREFUSED só na mensagem"))).toBe(false);
    expect(isDatabaseUnavailable(null)).toBe(false);
    expect(isDatabaseUnavailable("ECONNREFUSED")).toBe(false);
  });
});
