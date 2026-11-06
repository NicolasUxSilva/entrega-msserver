/**
 * Moldura comum das rotas `/api/integration/v1/*`: autenticação por credencial de
 * serviço, escopo, limite de requisições, validação da SAÍDA contra o contrato, erros
 * padronizados e log de acesso (sem token, sem dados).
 *
 * As dependências (busca da credencial, relógio, log) são injetáveis para os testes de
 * rota rodarem sem banco. As rotas reais usam `defaultDeps`.
 */
import type { z } from "zod";

import { CONTRACT_VERSION } from "./contract";
import { authenticate, type AuthenticatedClient, type IntegrationScope, type StoredCredential } from "./credentials";
import { ParamError } from "./map";

export interface IntegrationDeps {
  findByTokenId: (tokenId: string) => Promise<StoredCredential | null>;
  now: () => Date;
  log: (entry: Record<string, unknown>) => void;
  limiter: RateLimiter;
}

export interface HandlerResult {
  data: unknown;
  nextCursor?: string | null;
}

export type IntegrationHandler = (ctx: {
  client: AuthenticatedClient;
  params: URLSearchParams;
  now: Date;
}) => Promise<HandlerResult>;

/**
 * Janela fixa por credencial, em memória. Em serverless cada instância tem a sua, então
 * é uma proteção contra laço acidental do cliente, não um limite global.
 */
export class RateLimiter {
  private hits = new Map<string, { windowStart: number; count: number }>();
  constructor(
    private readonly limit = 120,
    private readonly windowMs = 60_000,
  ) {}
  allow(key: string, nowMs: number): boolean {
    const cur = this.hits.get(key);
    if (!cur || nowMs - cur.windowStart >= this.windowMs) {
      this.hits.set(key, { windowStart: nowMs, count: 1 });
      return true;
    }
    cur.count += 1;
    return cur.count <= this.limit;
  }
}

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-contract-version": CONTRACT_VERSION,
  "x-content-type-options": "nosniff",
};

const MESSAGES: Record<string, string> = {
  missing_token: "Credencial ausente: envie Authorization: Bearer <token>.",
  invalid_token: "Credencial inválida.",
  expired_token: "Credencial expirada: emita uma nova.",
  revoked_token: "Credencial revogada.",
  insufficient_scope: "A credencial não tem o escopo exigido por esta rota.",
  rate_limited: "Muitas requisições: tente de novo em um minuto.",
  invalid_params: "Parâmetros inválidos.",
  internal_error: "Erro interno. Nenhum dado foi alterado.",
};

function errorResponse(status: number, code: string, message?: string, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: { code, message: message ?? MESSAGES[code] ?? code } }), {
    status,
    headers: { ...HEADERS, ...extra },
  });
}

export function createIntegrationRoute(opts: {
  scope: IntegrationScope;
  /** schema do envelope completo da resposta (ver `./contract`) */
  response: z.ZodTypeAny;
  handler: IntegrationHandler;
  deps: IntegrationDeps;
}) {
  return async function GET(request: Request): Promise<Response> {
    const { deps } = opts;
    const started = Date.now();
    const now = deps.now();
    const url = new URL(request.url);
    const logBase = { event: "integration_request", path: url.pathname };

    const auth = await authenticate({
      authorization: request.headers.get("authorization"),
      requiredScope: opts.scope,
      now,
      findByTokenId: deps.findByTokenId,
    });
    if (!auth.ok) {
      deps.log({ ...logBase, status: auth.status, code: auth.code, ms: Date.now() - started });
      return errorResponse(auth.status, auth.code, undefined, auth.status === 401 ? { "www-authenticate": "Bearer" } : {});
    }
    const { client } = auth;
    const who = { credential: client.tokenId, client: client.name };

    if (!deps.limiter.allow(client.credentialId, now.getTime())) {
      deps.log({ ...logBase, ...who, status: 429, ms: Date.now() - started });
      return errorResponse(429, "rate_limited", undefined, { "retry-after": "60" });
    }

    try {
      const result = await opts.handler({ client, params: url.searchParams, now });
      const body = {
        contract_version: CONTRACT_VERSION,
        server_time: now.toISOString(),
        data: result.data,
        next_cursor: result.nextCursor ?? null,
      };
      const checked = opts.response.safeParse(body);
      if (!checked.success) {
        // a resposta não cumpre o contrato: não entrega nada pela metade
        deps.log({ ...logBase, ...who, status: 500, code: "contract_violation", issues: checked.error.issues.length });
        return errorResponse(500, "internal_error");
      }
      deps.log({ ...logBase, ...who, status: 200, ms: Date.now() - started });
      return new Response(JSON.stringify(checked.data), { status: 200, headers: HEADERS });
    } catch (err) {
      if (err instanceof ParamError) {
        deps.log({ ...logBase, ...who, status: 400, ms: Date.now() - started });
        return errorResponse(400, "invalid_params", err.message);
      }
      deps.log({ ...logBase, ...who, status: 500, code: "internal_error", ms: Date.now() - started });
      return errorResponse(500, "internal_error");
    }
  };
}
