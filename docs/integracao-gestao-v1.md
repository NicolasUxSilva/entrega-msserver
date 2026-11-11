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
# DATABASE_URL só na sessão do shell — NÃO grave a URL de produção em .env.local nem em arquivo
read -rs DATABASE_URL && export DATABASE_URL
node scripts/credencial-integracao.mjs workspaces
node scripts/credencial-integracao.mjs emitir --workspace <uuid> --nome gestao-msserver --dias 180
node scripts/credencial-integracao.mjs listar --workspace <uuid>
node scripts/credencial-integracao.mjs revogar --token-id <id>
unset DATABASE_URL
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
| 503 | `database_unavailable` | banco indisponível (rede, conexão recusada/encerrada, excesso de conexões); vem com `Retry-After: 30`. Nenhum detalhe interno na resposta. Mantenha os últimos dados válidos e tente de novo. |

## Endpoints

### `GET /api/integration/v1/health`
Workspace e credencial (nome, escopos, validade). Use para testar a configuração.

### `GET /api/integration/v1/sources`
Uma linha por fonte (`ga4`, `google_ads`, `meta_ads`, `rd_station_marketing`, `rd_station_crm`):
`state` (`synced`, `needs_reauth`, `error`, `sync_failed`, `no_account`, `never_synced`,
`no_data`, `not_connected`), `message` (frase fixa por estado — **nunca** o texto de erro do
provedor), `last_synced_at` (última importação bem-sucedida, inclusive `partial`),
`coverage {first,last}` e **`freshness`** (campo aditivo da v1):

| campo | significado |
|---|---|
| `status` | `fresh` (atualizada e completa) · `stale` (há dados, mas a fonte deixou de atualizar) · `incomplete` (atualizada, mas a última importação terminou `partial`) · `unavailable` (não há dados utilizáveis) |
| `reasons` | todos os motivos: `not_connected`, `no_account`, `never_synced`, `no_data`, `no_successful_sync`, `connection_needs_attention` (reconectar/erro — as próximas importações não vão acontecer), `last_sync_failed`, `last_sync_partial`, `sync_overdue` (mais de `stale_after_hours` sem sucesso), `sync_running` |
| `last_successful_sync_at` | igual a `last_synced_at` |
| `hours_since_success` | horas desde a última importação bem-sucedida; `null` = nunca |
| `stale_after_hours` | limite usado (36 h: sincronização diária + folga) |
| `last_attempt` | `{status, started_at, finished_at}` da última tentativa (`running`, `success`, `partial`, `failed`); `null` = nenhuma registrada |
| `data_through` | último dia com dados importados; `null` = nenhum dado |
| `data_lag_days` | dias entre `data_through` e hoje (America/Sao_Paulo); `null` sem dados |

Regras para o cliente: **ausência de dado nunca é zero** — fonte `unavailable` não tem
indicadores, e um dia sem linha em `/traffic` ou `/ads` é dia sem dado importado, não
"zero sessões". Só trate como atual o que vier com `freshness.status = "fresh"`; mostre
`stale`/`incomplete` com aviso. Use `coverage` para saber quais dias um intervalo cobre.

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

**Uma importação por conexão de cada vez** (`src/server/sync/lock.ts`): o cron e o botão
"Importar" passam pela mesma trava. Se já há uma importação da conexão em andamento
(`sync_runs` `running` com menos de 15 min), a nova não começa: o botão mostra o aviso e o
cron registra `already_running`. Um `running` mais antigo que 15 min é considerado
abandonado e não bloqueia. A trava não cria tabela nem altera linhas existentes.
Com o banco indisponível, a rota responde `503 database_unavailable` (sem detalhes).

## Login (cadastro)

Regra (`src/server/auth/allowlist.ts`):

1. O e-mail precisa estar **verificado pelo Google** — vale para todos.
2. **Quem já tem conta** (linha em `users`) **entra sempre**: a lista não bloqueia usuários
   atuais, e esquecer de configurá-la não tranca ninguém que já usa o sistema.
3. **Conta nova** só entra se o e-mail estiver em `AUTH_ALLOWED_EMAILS` ou o domínio em
   `AUTH_ALLOWED_DOMAINS` (domínio exato; subdomínio não vale).
4. Sem nenhuma das duas listas: em produção, contas novas **não** entram (as existentes
   sim); fora de produção, entra qualquer e-mail verificado.

Recusas vão para o log como `sign_in_denied` com o motivo e só o domínio (nunca o e-mail
completo). Para tirar o acesso de quem já tem conta, é preciso removê-lo do banco.
**Antes de publicar, revise a tabela `users`**: o cadastro era aberto, então ela pode ter
contas que não deveriam continuar entrando.

## Testes

```bash
pnpm test                                    # inclui os testes da integração (sem banco)
INTEGRATION_TEST_DB_URL=postgres://…/descartavel pnpm exec vitest run \
  src/server/integration/__tests__/isolation-db.test.ts src/server/sync/__tests__/lock-db.test.ts
```

A suíte com banco é opt-in, **apaga e recria dados de teste** e deve rodar só num banco
descartável com as migrações aplicadas. Ela prova isolamento entre workspaces, ausência de
tokens/erros brutos nas respostas, paginação sem repetição e que as rotas não escrevem nada
(rodam numa conexão `default_transaction_read_only = on`), credencial revogada, expirada,
forjada ou sem escopo, e o `freshness` de `/sources`. `lock-db.test.ts` prova que 8
tentativas simultâneas da mesma conexão iniciam uma só importação, que um `running`
abandonado não bloqueia e que usuários existentes são reconhecidos no login.

## Checklist para publicar (responsável: Nicolas)

1. Revisar e integrar a branch `integracao/gestao-v1`.
2. Aplicar a migração `0006_service_credentials` (só cria uma tabela nova).
3. Configurar na Vercel: `AUTH_ALLOWED_EMAILS` e/ou `AUTH_ALLOWED_DOMAINS` (só restringem
   contas **novas**; as existentes continuam entrando), `CRON_SECRET`,
   `SCHEDULED_SYNC_WORKSPACE_IDS`, `SCHEDULED_SYNC_BUDGET_SECONDS` (Hobby: até 50; Pro: até 270).
4. Conferir a região das funções da Vercel perto do banco (ex.: Neon `sa-east-1` → `gru1`),
   via `regions` no `vercel.json` ou no painel — o `preferredRegion` no código está
   obsoleto no Next 16.
5. Emitir a credencial `gestao-msserver` para o workspace da MSServer e entregar o token
   à MSServer por canal seguro.
6. Publicar o app OAuth do Google em produção (em "Testing" o refresh token do GA4 expira
   em ~7 dias e a sincronização agendada vai pular a fonte como `needs_reauth`).
