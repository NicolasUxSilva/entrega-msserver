/**
 * Configuração do Auth.js (v5) — bloco A2.
 *
 * - Provider único: Google (login da aplicação). Scopes mínimos: openid email
 *   profile. NÃO pede nenhum scope de dados aqui — o acesso ao GA4 é um fluxo
 *   OAuth separado, montado no bloco B1 com o MESMO client Google.
 * - Sessão JWT pura: sem adapter, sem tabela de sessão.
 * - No login, `ensureUserAndWorkspace` cria (ou recupera) o usuário e seu
 *   workspace, e os ids vão para o token/sessão.
 */
import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

import { env } from "@/env";

import { decideSignIn, normalizeEmail, parseList } from "./allowlist";
import { ensureUserAndWorkspace, userExistsByEmail } from "./provision";
import "./types"; // augmentação de Session / JWT

export const authConfig = {
  secret: env.AUTH_SECRET,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Google({
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      authorization: {
        params: { scope: "openid email profile", prompt: "select_account" },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, profile }) {
      // E-mail verificado pelo Google é obrigatório. Quem já tem conta entra sempre; conta
      // nova só pela lista de e-mails/domínios autorizados (ver ./allowlist).
      const email = normalizeEmail(user?.email);
      const decision = decideSignIn(
        {
          email,
          emailVerified: typeof profile?.email_verified === "boolean" ? profile.email_verified : undefined,
          existingUser: email ? await userExistsByEmail(email) : false,
        },
        {
          emails: parseList(env.AUTH_ALLOWED_EMAILS),
          domains: parseList(env.AUTH_ALLOWED_DOMAINS),
          production: env.NODE_ENV === "production",
        },
      );
      if (!decision.allowed) {
        // sem o e-mail completo no log: só o domínio e o motivo
        const domain = email ? email.slice(email.lastIndexOf("@") + 1) : null;
        console.info(JSON.stringify({ event: "sign_in_denied", reason: decision.reason, domain }));
      }
      return decision.allowed;
    },
    async jwt({ token, user }) {
      // `user` só é populado no primeiro passo do login.
      if (user?.email) {
        const ctx = await ensureUserAndWorkspace({
          email: user.email,
          name: user.name ?? null,
          image: user.image ?? null,
        });
        token.uid = ctx.userId;
        token.wsId = ctx.workspaceId;
        token.role = ctx.role;
      }
      return token;
    },
    session({ session, token }) {
      if (token.uid) session.user.id = token.uid;
      if (token.wsId) session.workspaceId = token.wsId;
      if (token.role) session.role = token.role;
      return session;
    },
  },
} satisfies NextAuthConfig;
