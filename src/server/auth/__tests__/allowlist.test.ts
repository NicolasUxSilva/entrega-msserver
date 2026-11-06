import { describe, expect, it } from "vitest";

import { decideSignIn, isSignInAllowed, normalizeEmail, parseList } from "../allowlist";

const cfg = (emails: string, domains: string, production = true) => ({
  emails: parseList(emails),
  domains: parseList(domains),
  production,
});

// sem o 2º argumento = verificado; `undefined` explícito = o Google não informou
function novo(email: string | null, ...v: [] | [boolean | undefined]) {
  return { email, emailVerified: v.length ? v[0] : true, existingUser: false };
}
function existente(email: string, ...v: [] | [boolean | undefined]) {
  return { email, emailVerified: v.length ? v[0] : true, existingUser: true };
}

describe("decideSignIn — usuários existentes", () => {
  it("usuário existente entra mesmo fora da lista", () => {
    const c = cfg("outro@msserver.com.br", "msserver.com.br");
    expect(decideSignIn(existente("antigo@gmail.com"), c)).toEqual({ allowed: true, reason: "existing_user" });
  });
  it("usuário existente entra em produção sem nenhuma lista configurada (sem bloqueio geral)", () => {
    expect(decideSignIn(existente("antigo@gmail.com"), cfg("", ""))).toEqual({ allowed: true, reason: "existing_user" });
  });
  it("usuário existente com e-mail não verificado (ou sem a informação) não entra", () => {
    expect(isSignInAllowed(existente("antigo@gmail.com", false), cfg("", ""))).toBe(false);
    expect(isSignInAllowed(existente("antigo@gmail.com", undefined), cfg("", ""))).toBe(false);
  });
});

describe("decideSignIn — contas novas", () => {
  it("em produção sem lista, conta nova não entra (cadastro fechado)", () => {
    expect(decideSignIn(novo("a@gmail.com"), cfg("", ""))).toEqual({ allowed: false, reason: "signup_closed" });
  });
  it("fora de produção sem lista mantém o comportamento antigo", () => {
    expect(decideSignIn(novo("a@gmail.com"), cfg("", "", false))).toEqual({
      allowed: true,
      reason: "open_outside_production",
    });
  });
  it("aceita e-mail listado e domínio listado, sem diferenciar maiúsculas", () => {
    const c = cfg(" Nicolas@Gmail.com ", "MSServer.com.br");
    expect(decideSignIn(novo("nicolas@gmail.com"), c).reason).toBe("listed_email");
    expect(decideSignIn(novo("Fulano@MSServer.com.br"), c).reason).toBe("listed_domain");
    expect(decideSignIn(novo("outro@gmail.com"), c)).toEqual({ allowed: false, reason: "not_listed" });
  });
  it("com lista configurada, fora de produção também restringe", () => {
    expect(isSignInAllowed(novo("outro@gmail.com"), cfg("", "msserver.com.br", false))).toBe(false);
  });
  it("não aceita subdomínio nem sufixo parecido", () => {
    const c = cfg("", "msserver.com.br");
    expect(isSignInAllowed(novo("x@evil-msserver.com.br"), c)).toBe(false);
    expect(isSignInAllowed(novo("x@msserver.com.br.evil.com"), c)).toBe(false);
    expect(isSignInAllowed(novo("x@sub.msserver.com.br"), c)).toBe(false);
  });
  it("e-mail não verificado, sem verificação informada, ausente ou malformado nunca entra", () => {
    const c = cfg("a@msserver.com.br", "msserver.com.br");
    expect(decideSignIn(novo("a@msserver.com.br", false), c).reason).toBe("email_not_verified");
    expect(decideSignIn(novo("a@msserver.com.br", undefined), c).reason).toBe("email_not_verified");
    expect(decideSignIn(novo(null), c).reason).toBe("missing_email");
    expect(decideSignIn(novo("a@b@msserver.com.br"), c).reason).toBe("missing_email");
    expect(decideSignIn(novo("sem-arroba"), c).reason).toBe("missing_email");
  });
});

describe("normalizeEmail", () => {
  it("normaliza espaços e maiúsculas e recusa formatos inválidos", () => {
    expect(normalizeEmail("  Fulano@MSServer.com.br ")).toBe("fulano@msserver.com.br");
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail("a b@c.d")).toBeNull();
  });
});
