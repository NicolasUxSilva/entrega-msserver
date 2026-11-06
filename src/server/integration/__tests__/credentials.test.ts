import { describe, expect, it } from "vitest";

import { generateToken as generateFromScript, hashSecret as hashFromScript } from "../../../../scripts/credencial-integracao.mjs";
import {
  authenticate,
  bearerFrom,
  generateToken,
  hashSecret,
  parseToken,
  type StoredCredential,
} from "../credentials";

const NOW = new Date("2026-11-04T12:00:00Z");

function stored(token: string, over: Partial<StoredCredential> = {}): StoredCredential {
  const p = parseToken(token)!;
  return {
    id: "cred-1",
    tokenId: p.tokenId,
    secretHash: hashSecret(p.secret),
    workspaceId: "11111111-1111-4111-8111-111111111111",
    name: "gestao-msserver",
    scopes: ["marketing:read"],
    expiresAt: new Date("2027-01-01T00:00:00Z"),
    revokedAt: null,
    ...over,
  };
}

const auth = (header: string | null, cred: StoredCredential | null) =>
  authenticate({
    authorization: header,
    requiredScope: "marketing:read",
    now: NOW,
    findByTokenId: async (id) => (cred && cred.tokenId === id ? cred : null),
  });

describe("formato do token", () => {
  it("gera tokens únicos no formato v0s_<id>_<segredo> e guarda só o hash", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a.token).toMatch(/^v0s_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.secretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.token).not.toContain(a.secretHash);
    expect(parseToken(a.token)?.tokenId).toBe(a.tokenId);
  });

  it("rejeita formatos inválidos", () => {
    for (const t of ["", "v0s_", "abc", "v0s_XYZ_abc", `v0s_${"a".repeat(16)}_curto`, `x0s_${"a".repeat(16)}_${"b".repeat(43)}`]) {
      expect(parseToken(t)).toBeNull();
    }
  });

  it("lê só Bearer", () => {
    expect(bearerFrom("Bearer abc")).toBe("abc");
    expect(bearerFrom("Basic abc")).toBeNull();
    expect(bearerFrom("Bearer")).toBeNull();
    expect(bearerFrom(null)).toBeNull();
  });

  it("o comando de emissão gera tokens que a API aceita (mesmo formato e hash)", async () => {
    const t = generateFromScript();
    expect(hashFromScript("x")).toBe(hashSecret("x"));
    const r = await auth(`Bearer ${t.token}`, {
      ...stored(t.token),
      secretHash: t.secretHash,
    });
    expect(r.ok).toBe(true);
  });
});

describe("authenticate", () => {
  const { token } = generateToken();

  it("aceita credencial válida e devolve o workspace DA CREDENCIAL", async () => {
    const r = await auth(`Bearer ${token}`, stored(token));
    expect(r.ok && r.client.workspaceId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("401 sem cabeçalho, com token malformado, inexistente ou com segredo errado", async () => {
    expect(await auth(null, stored(token))).toMatchObject({ ok: false, status: 401, code: "missing_token" });
    expect(await auth("Bearer lixo", stored(token))).toMatchObject({ status: 401, code: "invalid_token" });
    expect(await auth(`Bearer ${token}`, null)).toMatchObject({ status: 401, code: "invalid_token" });
    const other = generateToken().token.split("_")[2];
    const forged = `v0s_${parseToken(token)!.tokenId}_${other}`;
    expect(await auth(`Bearer ${forged}`, stored(token))).toMatchObject({ status: 401, code: "invalid_token" });
  });

  it("401 para revogada e expirada", async () => {
    expect(await auth(`Bearer ${token}`, stored(token, { revokedAt: new Date("2026-11-01T00:00:00Z") }))).toMatchObject({
      status: 401,
      code: "revoked_token",
    });
    expect(await auth(`Bearer ${token}`, stored(token, { expiresAt: NOW }))).toMatchObject({
      status: 401,
      code: "expired_token",
    });
  });

  it("403 sem o escopo exigido", async () => {
    expect(await auth(`Bearer ${token}`, stored(token, { scopes: ["outra:coisa"] }))).toMatchObject({
      status: 403,
      code: "insufficient_scope",
    });
  });
});
