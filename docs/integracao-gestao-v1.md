# API de integração v1 — V0-saas → Gestão Inteligente

API **privada, autenticada e somente leitura** para outro sistema (o primeiro é a Gestão
Inteligente da MSServer) ler os indicadores, o estado das fontes e os diagnósticos de UM
workspace do V0-saas. O cliente nunca acessa o banco do V0-saas.

Código: `src/server/integration/` (regras e contrato) e `src/app/api/integration/v1/` (rotas).
Contrato executável: `src/server/integration/contract.ts` (schemas Zod).

## Autenticação

```
Authorization: Bearer v0s_<token_id>_<segredo>
```

- Uma **credencial de serviço** pertence a **um workspace** e tem escopos (`marketing:read`).
  O workspace vem da credencial; nenhum parâmetro da requisição escolhe workspace
  (`?workspace_id=` é ignorado).
- No banco (`service_credentials`) fica só `sha256(segredo)`; o token completo aparece uma
  vez, na emissão.
- Validade obrigatória (padrão 180 dias, máx. 366). Revogação imediata.
- Segredo independente do `AUTH_SECRET` (sessão) e do `CRON_SECRET` (sincronização).

### Operação

```bash
node --env-file=.env.local scripts/credencial-integracao.mjs workspaces
node --env-file=.env.local scripts/credencial-integracao.mjs emitir --workspace <uuid> --nome gestao-msserver --dias 180
node --env-file=.env.local scripts/credencial-integracao.mjs listar --workspace <uuid>
node --env-file=.env.local scripts/credencial-integracao.mjs revogar --token-id <id>
```

**Rotação sem interrupção:** emitir a nova → trocar no cliente → conferir `/health` com a
nova → revogar a antiga. Entregue o token ao cliente por um canal seguro (nunca chat/e-mail).

## Convenções

- Só `GET`. Respostas com `Cache-Control: no-store` e `X-Contract-Version: 1.0`.
- Envelope:
  ```json
  { "contract_version": "1.0", "server_time": "2026-11-04T12:00:00.000Z", "data": …, "next_cursor": null }
  ```
- Datas `YYYY-MM-DD` (dia no fuso da conta/propriedade de origem); instantes ISO-8601 UTC.
- Dinheiro e quantidades fracionárias como **texto decimal** (`"123.4500"`); contagens como inteiro.
- Paginação por cursor opaco: repita a chamada com `cursor=<next_cursor>` até vir `null`.
- Erros: `{ "error": { "code": "…", "message": "…" } }`

| status | code | quando |
|---|---|---|
| 400 | `invalid_params` | parâmetro inválido (a mensagem diz qual) |
| 401 | `missing_token`, `invalid_token`, `expired_token`, `revoked_token` | credencial |
| 403 | `insufficient_scope` | credencial sem `marketing:read` |
| 429 | `rate_limited` | mais de 120 req/min por credencial (por instância) |
| 500 | `internal_error` | erro interno ou resposta fora do contrato (nada é entregue pela metade) |

## Endpoints

### `GET /api/integration/v1/health`
Workspace e credencial (nome, escopos, validade). Use para testar a configuração.

### `GET /api/integration/v1/sources`
Uma linha por fonte (`ga4`, `google_ads`, `meta_ads`, `rd_station_marketing`, `rd_station_crm`):
`state` (`synced`, `needs_reauth`, `error`, `sync_failed`, `no_account`, `never_synced`,
`no_data`, `not_connected`), `message` (frase fixa por estado — **nunca** o texto de erro do
provedor), `last_synced_at`, `coverage {first,last}`.

### `GET /api/integration/v1/traffic/daily?from=&to=&limit=&cursor=`
GA4 por dia × canal (`sessionDefaultChannelGroup`): `sessions`, `engaged_sessions`,
`new_users`, `key_events`, `conversion_value`. Sem `from`/`to`: últimos 90 dias até ontem.
Intervalo máximo 366 dias. `limit` 1–5000 (padrão 1000).

*Usuários totais* não são expostos: não são somáveis entre dias/canais.

### `GET /api/integration/v1/ads/campaigns/daily?from=&to=&limit=&cursor=`
Mídia paga por dia × plataforma × campanha: `impressions`, `clicks`, `cost`, `conversions`,
`conversion_value`, `currency` (da conta, sem conversão cambial), `campaign_status` e
`conversion_definition`:

| plataforma | `conversion_definition` |
|---|---|
| google_ads | `google_ads.metrics.conversions` |
| meta_ads | `meta_ads.actions:lead+purchase+complete_registration` |

As definições são diferentes: **não some conversões de plataformas distintas**.

### `GET /api/integration/v1/diagnostics?period_days=`
Diagnósticos atuais, ordenados por natureza e gravidade:
- `origin: "ga4_engine"` — insights da análise mais recente do motor do GA4 (exceto os
  descartados no V0-saas);
- `origin: "campaign_rules"` — regras A–G da área Campanhas, calculadas na hora para os
  últimos `period_days` dias (7, 14, 28, 30 ou 90; padrão 28) contra o período anterior.

Vocabulário unificado: `kind` (`finding`, `opportunity`, `inconclusive`, `limitation`),
`severity` (`high`, `medium`, `low`, `info`), `confidence` (`high`, `medium`, `low`).
`recommendation` é o próximo passo; `limitation` explica por que a conclusão é limitada;
`link` aponta para a tela do V0-saas (exige login no V0-saas).

ROAS, CAC e atribuição comercial **não** são calculados por esta API.

## Compatibilidade

- Campo novo opcional: pode entrar na v1 (o cliente ignora o que não conhece).
- Remover/renomear campo, mudar tipo ou significado: nova versão `/api/integration/v2`,
  publicada **ao lado** da v1 até o cliente migrar.
- Qualquer mudança no contrato passa pelos testes `src/server/integration/__tests__/`.

## Sincronização agendada

`GET /api/cron/sync` (Vercel Cron, `vercel.json`: todo dia 09:00 UTC = 06:00 em Brasília).
Usa o mesmo `runSync` do botão "Importar". Antes de importar, confere cada conexão e pula,
com motivo, as que não podem funcionar: `needs_reauth`, `connection_error`,
`no_account_selected`, `token_expired_without_refresh` (Meta). Só sincroniza os workspaces
de `SCHEDULED_SYNC_WORKSPACE_IDS`. Orçamento de tempo por execução
(`SCHEDULED_SYNC_BUDGET_SECONDS`, padrão 270 s): o que não couber fica para o dia seguinte,
começando pelas importações mais antigas.

## Login (cadastro)

`AUTH_ALLOWED_EMAILS` / `AUTH_ALLOWED_DOMAINS` definem quem entra. E-mail precisa estar
verificado pelo Google. **Em produção, sem nenhuma das duas listas, ninguém entra.**

## Testes

```bash
pnpm test                                    # inclui os testes da integração (sem banco)
INTEGRATION_TEST_DB_URL=postgres://…/descartavel pnpm exec vitest run \
  src/server/integration/__tests__/isolation-db.test.ts
```

A suíte com banco é opt-in, **apaga e recria dados de teste** e deve rodar só num banco
descartável com as migrações aplicadas. Ela prova isolamento entre workspaces, ausência de
tokens/erros brutos nas respostas, paginação sem repetição e que as rotas não escrevem nada
(rodam numa conexão `default_transaction_read_only = on`).

## Checklist para publicar (responsável: Nicolas)

1. Revisar e integrar a branch `integracao/gestao-v1`.
2. Aplicar a migração `0006_service_credentials` (só cria uma tabela nova).
3. Configurar na Vercel: `AUTH_ALLOWED_EMAILS` e/ou `AUTH_ALLOWED_DOMAINS` (**antes** do
   deploy — sem elas ninguém entra), `CRON_SECRET`, `SCHEDULED_SYNC_WORKSPACE_IDS`,
   `SCHEDULED_SYNC_BUDGET_SECONDS` (Hobby: até 50; Pro: até 270).
4. Conferir a região das funções da Vercel (perto do Neon `sa-east-1` → `gru1`).
5. Emitir a credencial `gestao-msserver` para o workspace da MSServer e entregar o token
   à MSServer por canal seguro.
6. Publicar o app OAuth do Google em produção (em "Testing" o refresh token do GA4 expira
   em ~7 dias e a sincronização agendada vai pular a fonte como `needs_reauth`).
