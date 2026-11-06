import { describe, expect, it } from "vitest";

import { isSignInAllowed, parseList } from "../allowlist";

const cfg = (emails: string, domains: string, production = true) => ({
  emails: parseList(emails),
  domains: parseList(domains),
  production,
});

describe("isSignInAllowed", () => {
  it("em produção sem lista ninguém entra (falha fechada)", () => {
    expect(isSignInAllowed({ email: "a@gmail.com", emailVerified: true }, cfg("", ""))).toBe(false);
  });
  it("fora de produção sem lista mantém o comportamento antigo", () => {
    expect(isSignInAllowed({ email: "a@gmail.com", emailVerified: true }, cfg("", "", false))).toBe(true);
  });
  it("aceita e-mail listado e domínio listado, sem diferenciar maiúsculas", () => {
    const c = cfg(" Nicolas@Gmail.com ", "msserver.com.br");
    expect(isSignInAllowed({ email: "nicolas@gmail.com", emailVerified: true }, c)).toBe(true);
    expect(isSignInAllowed({ email: "Fulano@MSServer.com.br", emailVerified: true }, c)).toBe(true);
    expect(isSignInAllowed({ email: "outro@gmail.com", emailVerified: true }, c)).toBe(false);
  });
  it("não aceita subdomínio nem sufixo parecido", () => {
    const c = cfg("", "msserver.com.br");
    expect(isSignInAllowed({ email: "x@evil-msserver.com.br", emailVerified: true }, c)).toBe(false);
    expect(isSignInAllowed({ email: "x@msserver.com.br.evil.com", emailVerified: true }, c)).toBe(false);
  });
  it("e-mail não verificado ou ausente nunca entra", () => {
    const c = cfg("a@msserver.com.br", "");
    expect(isSignInAllowed({ email: "a@msserver.com.br", emailVerified: false }, c)).toBe(false);
    expect(isSignInAllowed({ email: null, emailVerified: true }, c)).toBe(false);
  });
});
