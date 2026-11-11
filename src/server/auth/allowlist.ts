/**
 * Quem pode entrar pelo login Google.
 *
 * Antes desta regra qualquer conta Google criava um workspace próprio (cadastro aberto).
 * Agora a regra separa QUEM JÁ TEM CONTA de QUEM ESTÁ CHEGANDO:
 *
 *  1. O e-mail precisa existir e estar verificado pelo Google (`email_verified === true`).
 *     Sem essa confirmação ninguém entra — nem usuário existente (o Google sempre envia
 *     o campo para contas Google; ausência é tratada como não verificado).
 *  2. Usuário que JÁ EXISTE na tabela `users` entra sempre: a lista não bloqueia contas
 *     atuais, e esquecer de configurar a lista não tranca ninguém que já usa o sistema.
 *  3. Conta NOVA (primeiro login) só entra se o e-mail estiver em `AUTH_ALLOWED_EMAILS`
 *     ou o domínio em `AUTH_ALLOWED_DOMAINS`.
 *  4. Sem nenhuma das duas listas:
 *     - em PRODUÇÃO, contas novas não entram (cadastro fechado), mas as existentes sim;
 *     - fora de produção, qualquer e-mail verificado entra (comportamento antigo).
 *
 * Para retirar o acesso de alguém que já tem conta, é preciso removê-lo do banco (decisão
 * administrativa, fora desta regra).
 */
export interface AllowlistConfig {
  emails: string[];
  domains: string[];
  production: boolean;
}

export type SignInDecision =
  | { allowed: true; reason: "existing_user" | "listed_email" | "listed_domain" | "open_outside_production" }
  | { allowed: false; reason: "missing_email" | "email_not_verified" | "not_listed" | "signup_closed" };

const norm = (s: string) => s.trim().toLowerCase();

export function parseList(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map(norm).filter(Boolean);
}

export function normalizeEmail(email: string | null | undefined): string | null {
  const e = email ? norm(email) : "";
  // exatamente um "@", com algo dos dois lados
  return /^[^@\s]+@[^@\s]+$/.test(e) ? e : null;
}

export function decideSignIn(
  user: { email: string | null | undefined; emailVerified: boolean | undefined; existingUser: boolean },
  cfg: AllowlistConfig,
): SignInDecision {
  const email = normalizeEmail(user.email);
  if (!email) return { allowed: false, reason: "missing_email" };
  if (user.emailVerified !== true) return { allowed: false, reason: "email_not_verified" };

  if (user.existingUser) return { allowed: true, reason: "existing_user" };

  if (cfg.emails.includes(email)) return { allowed: true, reason: "listed_email" };
  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (cfg.domains.includes(domain)) return { allowed: true, reason: "listed_domain" };

  const configured = cfg.emails.length > 0 || cfg.domains.length > 0;
  if (configured) return { allowed: false, reason: "not_listed" };
  return cfg.production
    ? { allowed: false, reason: "signup_closed" }
    : { allowed: true, reason: "open_outside_production" };
}

/** Atalho booleano de `decideSignIn`. */
export function isSignInAllowed(
  user: { email: string | null | undefined; emailVerified: boolean | undefined; existingUser: boolean },
  cfg: AllowlistConfig,
): boolean {
  return decideSignIn(user, cfg).allowed;
}
