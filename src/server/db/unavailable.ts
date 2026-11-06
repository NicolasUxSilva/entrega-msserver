/**
 * "O banco está indisponível?" — classificação de erro usada para responder 503 padronizado
 * (sem repassar a mensagem original, que pode conter host, usuário ou trechos de URL).
 *
 * Percorre a cadeia `cause` (o Drizzle embrulha o erro do driver) e reconhece:
 *  - erros de rede do Node (`ECONNREFUSED`, `ETIMEDOUT`, …);
 *  - erros de conexão do driver `postgres` (`CONNECT_TIMEOUT`, `CONNECTION_CLOSED`, …);
 *  - SQLSTATE de conexão (classe `08`), desligamento do servidor (`57P01`–`57P03`) e
 *    excesso de conexões (`53300`).
 * Qualquer outro erro (SQL inválido, violação de restrição…) NÃO é indisponibilidade.
 */
const NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
]);

const SQLSTATES = new Set(["57P01", "57P02", "57P03", "53300"]);

export function isDatabaseUnavailable(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; depth < 8 && cur && typeof cur === "object"; depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && (NETWORK_CODES.has(code) || SQLSTATES.has(code) || /^08[0-9A-Z]{3}$/.test(code))) {
      return true;
    }
    if (cur instanceof AggregateError && cur.errors.some((e) => isDatabaseUnavailable(e))) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/** Segundos sugeridos no `Retry-After` quando o banco está indisponível. */
export const DATABASE_RETRY_AFTER_SECONDS = 30;
