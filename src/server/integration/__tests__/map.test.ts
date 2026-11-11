import { describe, expect, it } from "vitest";

import type { CampaignDiagnostic } from "@/lib/campaign-diagnostics";
import type { SourceStatus } from "@/lib/insight";

import { diagnosticSchema, sourceSchema } from "../contract";
import {
  ParamError,
  decodeCursor,
  encodeCursor,
  fromCampaignDiagnostic,
  fromInsightRow,
  parseDiagnosticPeriod,
  parseLimit,
  parseRange,
  sortDiagnostics,
  toContractSource,
} from "../map";

const q = (s: string) => new URLSearchParams(s);
const BASE = "https://v0.example.com";

describe("parâmetros", () => {
  it("sem from/to: últimos 90 dias até ontem", () => {
    expect(parseRange(q(""), "2026-11-04")).toEqual({ from: "2026-08-06", to: "2026-11-03" });
  });
  it("valida datas, ordem, futuro e tamanho do intervalo", () => {
    expect(parseRange(q("from=2026-10-01&to=2026-10-31"), "2026-11-04")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    for (const s of ["from=2026-10-01", "from=2026-02-30&to=2026-03-01", "from=2026-10-31&to=2026-10-01", "from=2026-11-01&to=2026-11-05", "from=2024-01-01&to=2026-01-01", "from=x&to=y"]) {
      expect(() => parseRange(q(s), "2026-11-04")).toThrow(ParamError);
    }
  });
  it("limit e period_days", () => {
    expect(parseLimit(q(""))).toBe(1000);
    expect(parseLimit(q("limit=10"))).toBe(10);
    for (const s of ["limit=0", "limit=5001", "limit=1.5", "limit=abc"]) expect(() => parseLimit(q(s))).toThrow(ParamError);
    expect(parseDiagnosticPeriod(q(""))).toBe(28);
    expect(parseDiagnosticPeriod(q("period_days=7"))).toBe(7);
    expect(() => parseDiagnosticPeriod(q("period_days=10"))).toThrow(ParamError);
  });
  it("cursor ida e volta; cursor adulterado vira erro de parâmetro", () => {
    const c = encodeCursor({ d: "2026-10-01", c: "Organic Search" });
    expect(decodeCursor(c, ["d", "c"])).toEqual({ d: "2026-10-01", c: "Organic Search" });
    expect(decodeCursor(null, ["d"])).toBeNull();
    for (const bad of ["@@@", Buffer.from("[]").toString("base64url"), encodeCursor({ d: "x" })]) {
      expect(() => decodeCursor(bad, ["d", "c"])).toThrow(ParamError);
    }
  });
});

describe("fontes", () => {
  const base: SourceStatus = {
    key: "ga4",
    label: "Google Analytics 4",
    health: "error",
    summary: "Erro na conexão: invalid_grant token=ya29.SEGREDO",
    notice: null,
    action: null,
    lastSyncedAt: "2026-11-03T09:00:00.000Z",
    coverage: { first: "2026-05-01", last: "2026-11-02" },
    feeds: "",
  };
  it("nunca repassa o texto bruto de erro do provedor", () => {
    const s = toContractSource(base);
    expect(sourceSchema.parse(s)).toBeTruthy();
    expect(JSON.stringify(s)).not.toContain("ya29");
    expect(JSON.stringify(s)).not.toContain("invalid_grant");
    expect(s.message).toBe("A conexão com a fonte está com erro no V0-saas.");
  });
});

const campaignDiag: CampaignDiagnostic = {
  id: "cost_per_result_increase:google_ads:campaign:123",
  type: "cost_per_result_increase",
  kind: "finding",
  platform: "google_ads",
  platformLabel: "Google Ads",
  level: "campaign",
  levelLabel: "Campanha",
  entity: { campaignId: "123", campaignName: "Busca Marca", adGroupId: null, adGroupName: null, adId: null, adName: null, href: "/campanhas/google_ads/123?periodo=28" },
  title: "Custo por resultado subiu",
  description: "…",
  evidence: [
    { key: "costPerResult", label: "Custo por resultado", format: "money", current: 30, previous: 20, deltaAbs: 10, deltaPct: 0.5, lowerIsBetter: true, note: null },
    { key: "results", label: "Resultados", format: "count", current: 10, previous: null, deltaAbs: null, deltaPct: Number.POSITIVE_INFINITY, lowerIsBetter: false, note: null },
  ] as CampaignDiagnostic["evidence"],
  facts: [],
  currency: "BRL",
  period: { current: { start: "2026-10-07", end: "2026-11-03" }, previous: { start: "2026-09-09", end: "2026-10-06" } },
  severity: "high",
  confidence: "medium",
  limitation: null,
  limitationReason: null,
  nextCheck: "Verifique termos de pesquisa.",
  metrics: ["costPerResult"],
  related: [],
  priority: 10,
};

describe("diagnósticos", () => {
  it("regras de campanha → contrato, com link absoluto e números finitos", () => {
    const d = fromCampaignDiagnostic(campaignDiag, BASE, new Date("2026-11-04T12:00:00Z"));
    expect(diagnosticSchema.parse(d)).toBeTruthy();
    expect(d.link).toBe("https://v0.example.com/campanhas/google_ads/123?periodo=28");
    expect(d.evidence[1]!.delta_pct).toBeNull();
    expect(d.recommendation).toBe("Verifique termos de pesquisa.");
    expect(d.id).toBe("camp:cost_per_result_increase:google_ads:campaign:123");
  });

  it("motor do GA4 → vocabulário unificado", () => {
    const d = fromInsightRow(
      {
        dedupeKey: "traffic-volume-drop:organic",
        detector: "traffic-volume-drop",
        kind: "problem",
        severity: "critical",
        confidence: "alta",
        title: "Queda de sessões orgânicas",
        explanation: "As sessões caíram.",
        hypothesis: "Mudança de ranqueamento.",
        recommendedAction: "Verifique o Search Console.",
        evidenceJson: { metricLabel: "Sessões", current: 800, previous: 1000, deltaPct: -0.2, format: "count", baseline: null },
        periodStart: "2026-10-06",
        periodEnd: "2026-11-02",
        updatedAt: new Date("2026-11-03T09:00:00Z"),
      },
      BASE,
    );
    expect(diagnosticSchema.parse(d)).toBeTruthy();
    expect(d).toMatchObject({ kind: "finding", severity: "high", confidence: "high", platform: "ga4", origin: "ga4_engine" });
    expect(d.evidence).toHaveLength(1);
  });

  it("evidência em formato inesperado não quebra (vira lista vazia)", () => {
    const d = fromInsightRow(
      {
        dedupeKey: "k",
        detector: "data-quality",
        kind: "data_quality",
        severity: "attention",
        confidence: "media",
        title: "t",
        explanation: "e",
        hypothesis: "",
        recommendedAction: "r",
        evidenceJson: { algo: "diferente" },
        periodStart: "2026-10-06",
        periodEnd: "2026-11-02",
        updatedAt: new Date(),
      },
      BASE,
    );
    expect(d).toMatchObject({ kind: "limitation", severity: "medium", confidence: "medium", hypothesis: null, evidence: [] });
  });

  it("ordena por natureza e gravidade", () => {
    const a = fromCampaignDiagnostic({ ...campaignDiag, id: "a", kind: "limitation", severity: "info" }, BASE, new Date());
    const b = fromCampaignDiagnostic({ ...campaignDiag, id: "b", kind: "finding", severity: "low" }, BASE, new Date());
    const c = fromCampaignDiagnostic({ ...campaignDiag, id: "c", kind: "finding", severity: "high" }, BASE, new Date());
    expect(sortDiagnostics([a, b, c]).map((d) => d.id)).toEqual(["camp:c", "camp:b", "camp:a"]);
  });
});
