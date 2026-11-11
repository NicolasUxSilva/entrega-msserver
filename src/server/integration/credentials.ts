/**
 * Credenciais de serviço da API de integração (`/api/integration/v1`) — parte PURA.
 *
 * Token: `v0s_<tokenId>_<segredo>`
 *  - `tokenId`: 16 caracteres hex, público, localiza a credencial (coluna `token_id`);
 *  - `segredo`: 32 bytes aleatórios em base64url (43 caracteres), mostrado UMA vez na
 *    emissão. No banco fica só `sha256(segredo)` em hex.
 *
 * A autorização sai inteira da credencial: o workspace é o dela (nunca um parâmetro da
 * requisição) e os escopos são os dela. Nenhuma função daqui toca o banco: quem chama
 * entrega a busca (`findByTokenId`), o que mantém a regra testável sem Postgres.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const TOKEN_PREFIX = "v0s";
export const INTEGRATION_SCOPES = ["marketing:read"] as const;
export type IntegrationScope = (typeof INTEGRATION_SCOPES)[number];

const TOKEN_RE = /^v0s_([0-9a-f]{16})_([A-Za-z0-9_-]{43})$/;

export interface IssuedToken {
  token: string;
  tokenId: string;
  secretHash: string;
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** Gera um token novo. O `token` completo só existe neste retorno. */
export function generateToken(): IssuedToken {
  const tokenId = randomBytes(8).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  return { token: `${TOKEN_PREFIX}_${tokenId}_${secret}`, tokenId, secretHash: hashSecret(secret) };
}

export function parseToken(token: string): { tokenId: string; secret: string } | null {
  const m = TOKEN_RE.exec(token);
  return m ? { tokenId: m[1]!, secret: m[2]! } : null;
}

/** `Authorization: Bearer <token>` → token, ou null (formato errado, vazio, outro esquema). */
export function bearerFrom(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer[ ]+(\S+)[ ]*$/.exec(header);
  return m ? m[1]! : null;
}

export interface StoredCredential {
  id: string;
  tokenId: string;
  secretHash: string;
  workspaceId: string;
  name: string;
  scopes: string[];
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface AuthenticatedClient {
  credentialId: string;
  tokenId: string;
  name: string;
  workspaceId: string;
  scopes: string[];
  expiresAt: Date;
}

export type AuthFailure =
  | { ok: false; status: 401; code: "missing_token" | "invalid_token" | "expired_token" | "revoked_token" }
  | { ok: false; status: 403; code: "insufficient_scope" };

export type AuthResult = { ok: true; client: AuthenticatedClient } | AuthFailure;

function sameHash(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
}

/**
 * Valida o cabeçalho `Authorization` e o escopo exigido pela rota.
 * Mensagens de falha não distinguem "credencial inexistente" de "segredo errado".
 */
export async function authenticate(input: {
  authorization: string | null;
  requiredScope: IntegrationScope;
  now: Date;
  findByTokenId: (tokenId: string) => Promise<StoredCredential | null>;
}): Promise<AuthResult> {
  const token = bearerFrom(input.authorization);
  if (!token) return { ok: false, status: 401, code: "missing_token" };
  const parsed = parseToken(token);
  if (!parsed) return { ok: false, status: 401, code: "invalid_token" };

  const cred = await input.findByTokenId(parsed.tokenId);
  // compara mesmo sem credencial, para o tempo de resposta não revelar se o id existe
  const expected = cred?.secretHash ?? "0".repeat(64);
  const match = sameHash(hashSecret(parsed.secret), expected);
  if (!cred || !match) return { ok: false, status: 401, code: "invalid_token" };
  if (cred.revokedAt && cred.revokedAt <= input.now) return { ok: false, status: 401, code: "revoked_token" };
  if (cred.expiresAt <= input.now) return { ok: false, status: 401, code: "expired_token" };
  if (!cred.scopes.includes(input.requiredScope)) return { ok: false, status: 403, code: "insufficient_scope" };

  return {
    ok: true,
    client: {
      credentialId: cred.id,
      tokenId: cred.tokenId,
      name: cred.name,
      workspaceId: cred.workspaceId,
      scopes: cred.scopes,
      expiresAt: cred.expiresAt,
    },
  };
}
