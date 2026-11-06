#!/usr/bin/env node
/**
 * Credenciais de serviço da API de integração (/api/integration/v1).
 *
 *   node --env-file=.env.local scripts/credencial-integracao.mjs workspaces
 *   node --env-file=.env.local scripts/credencial-integracao.mjs emitir --workspace <uuid> --nome gestao-msserver [--dias 180]
 *   node --env-file=.env.local scripts/credencial-integracao.mjs listar [--workspace <uuid>]
 *   node --env-file=.env.local scripts/credencial-integracao.mjs revogar --token-id <id>
 *
 * O token completo aparece UMA vez, na emissão. No banco fica só sha256(segredo).
 * Rotação sem interrupção: emitir a nova → trocar no cliente → conferir → revogar a antiga.
 *
 * O formato do token e o hash precisam ser idênticos a src/server/integration/credentials.ts
 * (há um teste que compara as duas implementações).
 */
import { createHash, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

export const SCOPE = "marketing:read";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function hashSecret(secret) {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function generateToken() {
  const tokenId = randomBytes(8).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  return { token: `v0s_${tokenId}_${secret}`, tokenId, secretHash: hashSecret(secret) };
}

function arg(args, name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function fail(msg) {
  console.error(`Erro: ${msg}`);
  process.exit(1);
}

async function main(argv) {
  const [cmd, ...args] = argv;
  if (!cmd || !["workspaces", "emitir", "listar", "revogar"].includes(cmd)) {
    console.log("Uso: workspaces | emitir --workspace <uuid> --nome <nome> [--dias 180] | listar [--workspace <uuid>] | revogar --token-id <id>");
    process.exit(cmd ? 1 : 0);
  }
  const url = process.env.DATABASE_URL;
  if (!url) fail("DATABASE_URL não definida (use node --env-file=.env.local …).");

  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    if (cmd === "workspaces") {
      const rows = await sql`
        select w.id, w.name, count(m.id)::int as membros
        from workspaces w left join workspace_members m on m.workspace_id = w.id
        group by w.id order by w.created_at`;
      for (const r of rows) console.log(`${r.id}  ${r.name}  (${r.membros} membro(s))`);
      return;
    }

    if (cmd === "emitir") {
      const workspace = arg(args, "workspace");
      const nome = arg(args, "nome");
      const dias = Number(arg(args, "dias") ?? "180");
      if (!workspace || !UUID_RE.test(workspace)) fail("--workspace <uuid> é obrigatório.");
      if (!nome || !/^[a-z0-9][a-z0-9._-]{1,60}$/.test(nome)) fail("--nome deve ser curto, minúsculo, sem espaços (ex.: gestao-msserver).");
      if (!Number.isInteger(dias) || dias < 1 || dias > 366) fail("--dias deve ser um inteiro entre 1 e 366.");
      const [ws] = await sql`select id, name from workspaces where id = ${workspace}`;
      if (!ws) fail("workspace não encontrado.");

      const t = generateToken();
      const expires = new Date(Date.now() + dias * 86_400_000);
      await sql`
        insert into service_credentials (token_id, secret_hash, workspace_id, name, scopes, expires_at)
        values (${t.tokenId}, ${t.secretHash}, ${workspace}, ${nome}, ${[SCOPE]}, ${expires})`;
      console.log(`Credencial emitida para o workspace "${ws.name}".`);
      console.log(`  token_id:  ${t.tokenId}`);
      console.log(`  escopo:    ${SCOPE}`);
      console.log(`  expira em: ${expires.toISOString()}`);
      console.log("");
      console.log("Token (mostrado só agora — guarde direto no cliente, não em chat/e-mail):");
      console.log(t.token);
      return;
    }

    if (cmd === "listar") {
      const workspace = arg(args, "workspace");
      if (workspace && !UUID_RE.test(workspace)) fail("--workspace deve ser um uuid.");
      const rows = workspace
        ? await sql`select token_id, name, workspace_id, scopes, created_at, expires_at, revoked_at from service_credentials where workspace_id = ${workspace} order by created_at`
        : await sql`select token_id, name, workspace_id, scopes, created_at, expires_at, revoked_at from service_credentials order by created_at`;
      for (const r of rows) {
        const estado = r.revoked_at ? "revogada" : r.expires_at <= new Date() ? "expirada" : "ativa";
        console.log(`${r.token_id}  ${r.name}  ws=${r.workspace_id}  ${r.scopes.join(",")}  ${estado}  expira ${r.expires_at.toISOString()}`);
      }
      return;
    }

    if (cmd === "revogar") {
      const tokenId = arg(args, "token-id");
      if (!tokenId || !/^[0-9a-f]{16}$/.test(tokenId)) fail("--token-id deve ter 16 caracteres hex.");
      const rows = await sql`update service_credentials set revoked_at = now() where token_id = ${tokenId} and revoked_at is null returning name`;
      console.log(rows.length ? `Revogada: ${tokenId} (${rows[0].name}).` : "Nada a revogar (inexistente ou já revogada).");
    }
  } finally {
    await sql.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((e) => fail(e instanceof Error ? e.message : String(e)));
}
