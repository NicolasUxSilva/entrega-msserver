/**
 * Quem pode entrar no V0-saas pelo login Google.
 *
 * Antes desta regra qualquer conta Google criava um workspace próprio (cadastro aberto).
 * Agora:
 *  - `AUTH_ALLOWED_EMAILS` (lista separada por vírgula) e/ou `AUTH_ALLOWED_DOMAINS`
 *    (ex.: `msserver.com.br`) definem quem entra;
 *  - o e-mail precisa estar verificado pelo Google (`email_verified`);
 *  - em PRODUÇÃO, sem nenhuma das duas listas, ninguém entra (falha fechada): esquecer a
 *    configuração não reabre o cadastro. Em desenvolvimento/teste, sem listas, entra
 *    qualquer e-mail verificado (comportamento antigo, só fora de produção).
 */
export interface AllowlistConfig {
  emails: string[];
  domains: string[];
  production: boolean;
}

const norm = (s: string) => s.trim().toLowerCase();

export function parseList(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map(norm).filter(Boolean);
}

export function isSignInAllowed(
  user: { email: string | null | undefined; emailVerified: boolean | undefined },
  cfg: AllowlistConfig,
): boolean {
  const email = user.email ? norm(user.email) : "";
  if (!email || !email.includes("@")) return false;
  // o Google sempre informa `email_verified`; ausência explícita de verificação bloqueia
  if (user.emailVerified === false) return false;

  const configured = cfg.emails.length > 0 || cfg.domains.length > 0;
  if (!configured) return !cfg.production;

  const domain = email.slice(email.lastIndexOf("@") + 1);
  return cfg.emails.includes(email) || cfg.domains.includes(domain);
}
