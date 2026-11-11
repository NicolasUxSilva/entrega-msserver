# Auditoria técnica — Integração Gestão Inteligente MSServer (API v1)

> **Etapa 1 — somente auditoria.** Nada foi integrado, publicado ou aplicado. Este arquivo é a única alteração feita
> no repositório `NicolasUxSilva/entrega-msserver`. Data: 2026-11-05.

**Legenda de classificação** (usada em todo o relatório):
`Confirmado` (verificado por evidência direta) · `Validado localmente` (executado aqui, em ambiente descartável) ·
`Precisa de validação` · `Bloqueado por acesso` · `Requer autorização`.

Nada aqui está "validado em produção": não houve acesso a Neon, Vercel, Google Cloud nem às contas reais.

---

## Sumário executivo

- O código recebido é **tecnicamente compatível** com a `main` da entrega: 5 commits sobre `01bd416`, que é a base da
  entrega. A mesclagem foi testada numa cópia descartável **sem conflitos**. O único arquivo em comum é
  `.env.example`, e ele mescla sozinho. Testes, lint, typecheck e build passam. `Validado localmente`
- **O pacote foi escrito para o V0-saas original, não para a entrega.** As instruções mandam importar "na raiz do seu
  clone do V0-saas" e citam a branch `worktree-design-system-v1` (que só existe no V0-saas). Também descrevem um
  ambiente Vercel/Neon em funcionamento (funções em `iad1`, banco em `sa-east-1`). Já a entrega, pela própria
  documentação (`docs/entrega-ms-server.md` §6–§7), **ainda não tem deploy, banco ou contas conectadas**. Esse é o
  **bloqueador principal**: falta definir o ambiente-alvo (projeto Vercel e banco Neon da entrega). `Confirmado`
- **Incidente de segurança relatado no pacote** (`SEGURANCA.md`): um `.env` de uma cópia do repositório datada de
  **07/10/2026** ficou legível num servidor da MSServer. A separação da entrega aconteceu em 23/10/2026, então esse
  `.env` provavelmente tem **segredos do V0-saas de origem** (banco do piloto, `AUTH_SECRET`, `APP_ENCRYPTION_KEY`,
  OAuth Google, RD, Anthropic). Isso deve ser tratado à parte, no V0-saas. Está fora do escopo desta tarefa e
  não foi tocado. `Precisa de validação` / `Requer autorização`
- **Fase 3 inacessível:** a branch `fase-3-inteligencia` e o commit `4662006` não existem no GitHub
  (`git ls-remote`) nem no clone local do V0-saas. A integração **não depende** da Fase 3: foi construída sobre a
  Fase 2. Mas não dá para descartar que exista uma `0006` diferente na Fase 3. `Bloqueado por acesso`
- A API respeita a arquitetura pedida: só GET, workspace sempre vindo da credencial, nenhum acesso a tokens nem a
  erros brutos. Foram encontrados **pontos a corrigir antes de publicar** (§7). Os dois mais relevantes:
  - quando o banco falha durante a autenticação, a resposta é um 500 fora do contrato;
  - o contrato não sinaliza explicitamente quando os dados estão desatualizados.

---

## 1. Estado do repositório

| Verificação | Resultado | Classificação |
|---|---|---|
| Diretório | `/Users/nicolassilva/entrega-msserver` | Confirmado |
| `origin` | `https://github.com/NicolasUxSilva/entrega-msserver.git` (fetch/push) | Confirmado |
| Branch / commit | `main` em `98b2ce6` ("separar a entrega MS Server do SaaS de origem (base 01bd416)"), igual a `origin/main` (`git ls-remote`) | Confirmado |
| Alterações locais / não rastreados | nenhuma (`git status` limpo; sem stash) | Confirmado |
| Worktrees / outras sessões | só o worktree principal; nenhuma outra branch local ou remota | Confirmado |
| É a cópia de entrega? | sim: `docs/entrega-ms-server.md`, `src/brand.ts` ("MS Server"), base `01bd416` | Confirmado |
| Vínculo com Vercel | não há `.vercel/` nem `vercel.json` na `main` | Confirmado |

**Como o trabalho foi isolado:**
- O pacote foi extraído no scratchpad da sessão.
- O repositório foi clonado para uma pasta descartável, e a branch do bundle foi importada **só nesse clone**.
- Testes, build e servidor local rodaram ali, com variáveis **sintéticas**: banco inexistente em `127.0.0.1:1` e
  segredos aleatórios.

**O V0-saas original não foi modificado.** No clone local (`~/v0-saas`) só rodaram leituras (`remote -v`,
`branch`, `log`, `cat-file`). As refs do GitHub foram baixadas para o clone descartável, não para o checkout do
V0-saas.

---

## 2. Conteúdo e origem da branch `integracao/gestao-v1`

**Origem do pacote.** O caminho da VM (`/home/msserver/entregas/v0saas-integracao-gestao-v1/`) **não existe** nesta
máquina. O pacote foi recebido como `~/Downloads/v0saas-integracao-gestao-v1.tar.gz` (494 KB, 20 entradas, sem
caminhos absolutos nem `..`). `Confirmado`

| Item | Conteúdo | Classificação |
|---|---|---|
| `SHA256SUMS` | todos os 15 arquivos conferem | Validado localmente |
| `v0saas-integracao-gestao-v1.bundle` | bundle Git válido (`git bundle verify`); ref `refs/heads/integracao/gestao-v1` → `a0a4d53`; exige `01bd416` | Validado localmente |
| `patches/0001…0005` | aplicados com `git am` sobre `01bd416`; resultado **idêntico** ao bundle (diff vazio) | Validado localmente |
| `migrations/0006_service_credentials.sql` | idêntica à que está dentro da branch | Validado localmente |
| `LEIA-ME.md`, `integracao-gestao-v1.md`, `TESTES.md`, `SEGURANCA.md`, `COMMITS.txt`, `capturas/` (3 PNG, dados fictícios) | documentação | Confirmado |

O pacote é **uma branch exportada** (bundle + os mesmos commits em patches), mais documentação. Não há segredos no
pacote: arquivos e diffs foram inspecionados. `Confirmado`

**Commits** (autor `MSServer (Claude, VM aplicacao) <dev@msserver.com.br>`, 2026-11-04):

| Commit | Conteúdo |
|---|---|
| `bb74af7` | tabela `service_credentials` (migration 0006), `src/server/integration/credentials.ts`, `scripts/credencial-integracao.mjs` |
| `8cd50ac` | rotas `GET /api/integration/v1/{health,sources,traffic/daily,ads/campaigns/daily,diagnostics}`, contrato Zod, leituras, mapeamento |
| `fb7e7b1` | login restrito por `AUTH_ALLOWED_EMAILS`/`AUTH_ALLOWED_DOMAINS` (altera `auth/config.ts`) |
| `d5492bf` | sincronização diária `GET /api/cron/sync` + `vercel.json` (cron `0 9 * * *`) |
| `a0a4d53` | `docs/integracao-gestao-v1.md` |

**Base de origem:** `01bd416` (Fase 2), merge-base com a `main` da entrega. `Confirmado`

O pacote diz que a base é "a sua `main` atual (`01bd416`)". Isso já não vale para o V0-saas: a `main` do V0-saas no
GitHub está em `15bdf0c`, com 2 commits de design system depois de `01bd416`. Ou seja, o pacote também está
defasado em relação ao V0-saas. `Confirmado`

**Arquivos alterados:** 33 (5.149 inserções, 3 remoções). Arquivos existentes que mudam:
- `.env.example`
- `src/env.ts`
- `src/server/auth/config.ts`
- `src/server/db/schema.ts`
- `src/server/db/migrations/meta/_journal.json`

Os demais 28 arquivos são novos. `Confirmado`

---

## 3. Compatibilidade com o estado atual do `entrega-msserver`

| Verificação | Resultado | Classificação |
|---|---|---|
| Commits divergentes | a entrega tem 1 commit próprio (`98b2ce6`, marca + correção de `EmptyState`); a branch tem 5 | Confirmado |
| Arquivos em comum | só `.env.example` (blocos diferentes; auto-merge) | Validado localmente |
| Merge de teste (`--no-commit`, clone descartável) | sem conflitos | Validado localmente |
| Schema × migrations | `drizzle-kit generate` após o merge: "No schema changes" | Validado localmente |
| Proxy de sessão | `src/proxy.ts` ignora `/api/*`, então as rotas novas não caem no redirecionamento para `/login` | Confirmado |
| Dependências novas | nenhuma (`package.json`/lockfile inalterados) | Confirmado |
| Independência do V0-saas | o código não aponta para o V0-saas. O **processo** sugerido no pacote, sim: importar no V0-saas e publicar no ambiente existente | Confirmado |

**Mudanças que afetam funcionalidades existentes** (vão além da "API de leitura"):

1. **Login (`fb7e7b1`):** passa a exigir lista de e-mails/domínios e e-mail verificado.
   - Em produção, **sem as variáveis, ninguém entra** (inclusive o responsável).
   - Usuários já provisionados fora da lista perdem acesso.
   - Isso substitui a política documentada em `docs/entrega-ms-server.md` §4 ("restringir sem mudar código"). O
     doc não é atualizado pelos patches.
2. **Sincronização agendada (`d5492bf`):**
   - A entrega declara "importação agendada" **fora do escopo** (§1) e "Não há `vercel.json`" (§7).
   - O cron sincroniza **todas** as fontes (inclusive Meta e RD), não só GA4/Google Ads.
   - `maxDuration = 300` depende do plano da Vercel.
   - Exige atualizar `docs/entrega-ms-server.md` (§1, §3, §4, §7, §10) e `PROJECT_STATE.md`.

As duas mudanças são razoáveis, mas **cada uma é uma decisão de produto/operação própria**. Recomendo integrá-las
como decisões explícitas, não como "parte da API".

---

## 4. Dependências da Fase 3

| Pergunta | Resposta | Classificação |
|---|---|---|
| Construída antes ou depois da Fase 3? | antes: base `01bd416` = Fase 2 | Confirmado |
| Inclui/depende dos indicadores da Fase 3? | não. Lê só `fact_traffic_daily`, `fact_ad_performance_daily`, `insights`, `connections`/`sync_runs` (via `readSources`) e as regras da Fase 2 (`readCampaignDiagnostics`) | Confirmado |
| Depende da migration 0006? | sim, da **própria** 0006 (`service_credentials`) | Confirmado |
| Referencia tabelas/campos inexistentes na entrega? | não (build, typecheck e `drizzle-kit generate` limpos) | Validado localmente |
| Integra sem perder funcionalidades? | sim; os 1.362 testes existentes continuam passando | Validado localmente |
| Expõe dados da Fase 3? | não (o contrato v1 não tem nota de saúde, orçamento/entrega, criativos ou histórico) | Confirmado |
| A Fase 3 tem uma 0006 diferente? | **não verificável**: `fase-3-inteligencia`/`4662006` não estão no GitHub nem no clone local | Bloqueado por acesso |

**Estratégia recomendada:**
- A entrega declara a Fase 3 fora do escopo (§1). Manter a integração **sem** a Fase 3.
- Se a Fase 3 vier para a entrega no futuro, por cherry-pick revisado (§11 do doc), a migration dela deve ser
  **renumerada para depois da 0006 da entrega** (`0007+`). Isso só é seguro enquanto a 0006 da Fase 3 não tiver sido
  aplicada num banco que também vá receber a da entrega. Os bancos são separados por política (§3), então o risco
  de colisão no mesmo banco é baixo. Mesmo assim, ele precisa ser confirmado.
- Se a Gestão quiser indicadores da Fase 3, isso vira campos opcionais na v1 ou uma `/api/integration/v2`, depois
  que a Fase 3 for validada.

---

## 5. Contrato da API

Fonte: `src/server/integration/contract.ts` (schemas Zod) e `docs/integracao-gestao-v1.md`.

| Aspecto | Implementação | Classificação |
|---|---|---|
| Endpoints | `GET /api/integration/v1/health`, `/sources`, `/traffic/daily`, `/ads/campaigns/daily`, `/diagnostics` | Confirmado |
| Métodos | só `GET` exportado; POST → 405 | Validado localmente |
| Autenticação | `Authorization: Bearer v0s_<token_id 16 hex>_<segredo 43 base64url>`; o banco guarda só o `sha256(segredo)`; comparação em tempo constante, também quando o id não existe | Confirmado |
| Autorização | escopo `marketing:read` exigido em todas as rotas; revogação e expiração checadas a cada request | Confirmado |
| Identificação do workspace | **sempre** `credential.workspace_id`; nenhum parâmetro escolhe workspace (`?workspace_id=` é ignorado) | Confirmado (código + teste de rota) |
| Envelope | `{contract_version:"1.0", server_time, data, next_cursor}`; cabeçalhos `Cache-Control: no-store`, `X-Contract-Version: 1.0`, `nosniff` | Validado localmente |
| Erros | `{error:{code,message}}`: 400 `invalid_params`, 401 `missing/invalid/expired/revoked_token` (+ `WWW-Authenticate`), 403 `insufficient_scope`, 429 `rate_limited` (+ `Retry-After: 60`), 500 `internal_error` | Validado localmente (401, 405) |
| Validação de saída | resposta validada pelo schema antes de sair; fora do contrato → 500 sem payload parcial | Confirmado (teste) |
| Período | `from`/`to` inclusivos, juntos; padrão: últimos 90 dias até ontem (fuso America/Sao_Paulo); máximo 366 dias; `to` ≤ hoje | Confirmado |
| Plataforma | **não há filtro**: `ads/campaigns/daily` devolve Google Ads **e** Meta Ads; `diagnostics` devolve GA4, Google Ads e Meta | Confirmado |
| Paginação | cursor opaco por chave (keyset), `limit` 1–5000 (padrão 1000); cursor adulterado → 400 | Confirmado |
| Diagnósticos | `period_days` ∈ {7,14,28,30,90} (padrão 28); motor GA4 (análise mais recente, sem os descartados) + regras A–G calculadas na hora, sem gravar | Confirmado |
| Rate limiting | 120 req/min por credencial, **em memória por instância** | Confirmado |
| Versionamento | `/v1` no caminho + `X-Contract-Version`; campos novos opcionais na v1; quebra → `/v2` lado a lado | Confirmado |
| Frequência de atualização | os dados mudam quando há importação (manual ou cron diário 09:00 UTC); a API não sincroniza nada | Confirmado |

**Como a API distingue os estados de dado:**

| Estado | Como aparece | Avaliação |
|---|---|---|
| Valor zero | linha com `0` / `"0.0000"` | ok |
| Ausência de dados | `/sources` → `not_connected`, `no_account`, `never_synced`, `no_data`; `coverage: null` | ok por fonte, mas **ambíguo por dia** (ver §7, F2) |
| Dados incompletos | dias fora de `coverage` não têm linha; não há marca de "dia parcial" (GA4 consolida em até ~48 h) | **lacuna** |
| Dados desatualizados | só indiretamente: `last_synced_at` e `coverage.last`. Uma fonte `synced` há 20 dias continua `synced` | **lacuna** |
| Falha de sincronização | `state: sync_failed` / `error` / `needs_reauth`, com mensagem fixa (nunca o texto do provedor) | ok |
| Diagnóstico confirmado × indício | `kind` (`finding`/`opportunity`/`inconclusive`/`limitation`) + `confidence` (`high`/`medium`/`low`) + `limitation` | ok, mas o motor GA4 nunca produz `inconclusive` e só preenche `limitation` em `data_quality` |

### Contrato mínimo complementar proposto (para revisão, não implementado)

São campos **opcionais**, compatíveis com a v1:
- `/sources[]`:
  - `stale: boolean` (por exemplo, `last_synced_at` há mais de 36 h para GA4/Google Ads, limiar a definir);
  - `last_attempt_at`;
  - `last_attempt_status` (`success|partial|failed`).
- `traffic/daily` e `ads/campaigns/daily`: `meta.coverage {first,last}` da fonte e `meta.complete_through` (último
  dia considerado consolidado). Dias dentro do intervalo pedido e fora de `coverage` passam a ser explicitamente
  "sem dado", e não "zero".
- `diagnostics[]`: `data_as_of` (último dia de dado usado) e `based_on_stale_data: boolean`.
- Parâmetro `platform=google_ads|meta_ads` em `ads/campaigns/daily` e `platform=` em `diagnostics`.

---

## 6. Dados que serão expostos

| Rota | Dados | Não expõe |
|---|---|---|
| `/health` | id e **nome do workspace**, nome/escopos/validade da credencial | segredo, hash |
| `/sources` | por fonte (GA4, Google Ads, Meta, RD Marketing, RD CRM): estado, mensagem fixa, `last_synced_at`, cobertura | `last_error`, `sync_runs.error`, tokens, ids de conta |
| `/traffic/daily` | GA4 dia × canal: sessões, sessões engajadas, novos usuários, key events, valor | usuários totais, `raw_records` |
| `/ads/campaigns/daily` | dia × plataforma × campanha: id, nome, status, moeda, impressões, cliques, custo, conversões, valor, definição de conversão | grupos/anúncios, tokens |
| `/diagnostics` | título, descrição, hipótese, recomendação, limitação, evidência numérica, entidade (campanha/grupo/anúncio: id e nome), período, link para o V0-saas | dados de usuários |

**Observações de minimização:**
- **Meta Ads e RD são expostos**, embora a Gestão vá ignorar Meta nesta versão (`LEIA-ME.md` §7). Se o acordado é
  "GA4 + Google Ads", a API entrega mais do que o necessário. Recomendação: restringir por credencial (por exemplo,
  coluna `platforms`) ou ao menos por filtro.
- O **nome do workspace** é derivado do nome/e-mail de quem fez o primeiro login
  (`src/server/auth/provision.ts:23`), ou seja, é um dado pessoal leve. Recomendação: devolver só o `id`, ou um
  rótulo neutro.
- Os nomes de campanha/anúncio são dados de negócio, não pessoais. `Confirmado`

---

## 7. Avaliação de segurança

**Pontos fortes** (confirmados por leitura de código e testes):
- Workspace vem só da credencial.
- Leituras só com `select` e sempre filtradas por `workspace_id` (`src/server/integration/read.ts`).
- Nenhuma leitura de `*_token_enc`, `raw_records`, `last_error` ou `sync_runs.error`.
- Saída validada pelo schema.
- Mensagens de erro fixas.
- Log de acesso sem token (`token_id` público + nome do cliente).
- `no-store` em todas as respostas.
- Cron com segredo próprio e comparação em tempo constante.
- Proxy não interfere nas rotas.

**Escrita externa:**
- A API não chama provedores. `Confirmado`
- A sync (cron) usa o `runSync` existente. As chamadas `POST` vistas são de **leitura**: `googleAds:search`, GA4
  `runReport` e refresh de token. O único `DELETE` (Meta `/me/permissions`) está no fluxo de **desconexão**, não na
  sync. Nenhum `mutate`. `Confirmado (inspeção estática)`; `Precisa de validação` em execução.

**Achados:**

| # | Gravidade | Achado | Evidência | Classificação |
|---|---|---|---|---|
| F1 | média | Falha do banco **durante a autenticação** escapa da moldura (`authenticate` roda fora do `try` em `src/server/integration/http.ts`). O resultado é um 500 padrão do Next, sem corpo JSON do contrato, sem `no-store` e sem `X-Contract-Version`. O stack trace no log traz a consulta com o `token_id` (parte pública, **o segredo não aparece**) | servidor local com banco inacessível: `500` com corpo vazio; log com `params: <token_id>,1`; `grep v0s_` no log = 0 | Validado localmente |
| F2 | média | Sem sinal explícito de dado desatualizado/incompleto (ver §5). Regras de campanha calculadas sobre importação antiga parecem atuais | código de `toContractSource`/`readIntegrationDiagnostics` | Confirmado |
| F3 | média | `scripts/credencial-integracao.mjs` exige a `DATABASE_URL` **de produção** num `.env.local` e imprime o token no terminal. Isso conflita com "não copiar valores de produção para arquivos locais" | código do script | Confirmado |
| F4 | média | Commits de login e cron alteram comportamento existente, fora do escopo "API de leitura" (§3) | diff | Confirmado |
| F5 | baixa | Rate limit em memória por instância; requests **não autenticados** não são limitados (cada um faz uma consulta ao banco). O segredo de 256 bits torna força bruta inviável, mas sobra a carga | `http.ts` | Confirmado |
| F6 | baixa | Sem `last_used_at` nem tabela de auditoria: o monitoramento depende só dos logs da Vercel (retenção limitada) | schema | Confirmado |
| F7 | baixa | Exposição de Meta/RD e do nome do workspace além do necessário (§6) | contrato | Confirmado |
| F8 | baixa | `AUTH_URL` tem padrão `http://localhost:3000` (`src/env.ts:39`): sem a variável, os `link` dos diagnósticos apontariam para localhost | `env.ts` | Confirmado |
| F9 | baixa | Cursor não é amarrado a `from`/`to`: reutilizá-lo noutra consulta dá resultado coerente mas inesperado (não é problema de segurança) | `map.ts` | Confirmado |
| F10 | info | `/api/cron/sync` responde com ids internos de conexão (só para quem tem o `CRON_SECRET`) | rota | Confirmado |

**Isolamento entre workspaces:**
- Por construção, não há caminho para outro workspace: todas as consultas usam o `workspaceId` da credencial, e os
  testes de rota com leituras simuladas cobrem `?workspace_id=` de outro workspace. `Validado localmente` (testes sem
  banco)
- O teste com Postgres real (`isolation-db.test.ts`, 6 casos) **não pôde rodar aqui**: não há Docker nem Postgres
  nesta máquina. `Precisa de validação`

---

## 8. Estratégia da credencial de leitura

| Aspecto | Como funciona hoje | Avaliação |
|---|---|---|
| Geração | `randomBytes`: 8 bytes de id + 32 bytes de segredo, pelo script | ok |
| Armazenamento | só `sha256(segredo)` em hex; token completo exibido uma vez | ok (hash sem sal é adequado para segredo aleatório de 256 bits) |
| Validação | a cada request, no servidor: formato → busca por `token_id` → hash em tempo constante → revogação → expiração → escopo | ok |
| Escopo | um workspace + `marketing:read`; sem escrita | ok; sem restrição por plataforma (F7) |
| Revogação | `revogar --token-id`; efeito imediato (sem cache) | ok |
| Rotação | emitir nova → trocar na Gestão → conferir `/health` → revogar antiga; validade de 1–366 dias (padrão 180) | ok, mas o processo é manual |
| Monitoramento | só log `integration_request` (status, rota, `token_id`, nome, ms) | parcial (F6) |
| Separação de outros segredos | independente de `AUTH_SECRET`, `CRON_SECRET` e tokens OAuth | ok |
| Fora do repositório | nada versionado; `.env*` no `.gitignore` | Confirmado |

**Emissão sem copiar segredos de produção para arquivo local** (alternativas a F3, para decidir):
1. Rodar o script com `DATABASE_URL` só no ambiente do processo (por exemplo, colado de um gerenciador de
   segredos para uma variável de sessão do shell, sem arquivo), com o histórico do shell desligado.
2. Gerar token e hash localmente sem banco (sem `DATABASE_URL`) e inserir só o hash pelo SQL Editor do Neon.
3. Na Gestão, gravar o token direto no cofre de segredos dela, sem passar por chat/e-mail.

Nenhuma credencial foi criada nesta etapa.

---

## 9. Análise da migration `0006`

**SQL** (`src/server/db/migrations/0006_service_credentials.sql`, idêntico ao do pacote):
- `CREATE TABLE service_credentials` com:
  - `id uuid` PK, padrão `gen_random_uuid()`;
  - `token_id`, `secret_hash`, `name` e `scopes text[]`, todos `NOT NULL`;
  - `workspace_id uuid NOT NULL`;
  - `created_at`, `expires_at NOT NULL` e `revoked_at`.
- FK `workspace_id → workspaces(id) ON DELETE CASCADE`.
- `UNIQUE INDEX` em `token_id`; índice em `workspace_id`.
- Journal: `idx 6`, `tag 0006_service_credentials`, sequencial depois da 0005.

| Pergunta | Resposta | Classificação |
|---|---|---|
| O que cria/modifica? | cria 1 tabela, 1 FK, 2 índices | Confirmado |
| Aditiva ou destrutiva? | **aditiva**: nenhum `ALTER`/`DROP` em tabela existente | Confirmado |
| Afeta tabelas existentes? | não; só referencia `workspaces` (a FK em tabela nova não trava escrita relevante em `workspaces`) | Confirmado |
| Altera dados de workspaces? | não. Apagar um workspace passa a apagar também as credenciais dele (cascade), o que é desejável | Confirmado |
| Risco de perda/exposição? | não há perda. A tabela guarda hashes: vazamento do banco não revela tokens | Confirmado |
| Restrições a revisar | (opcional) `CHECK (expires_at > created_at)`, `CHECK (cardinality(scopes) > 0)`, coluna `last_used_at`. Não são bloqueantes. Mudar o SQL antes da primeira aplicação é seguro; depois, só com uma 0007 | Precisa de validação (decisão) |
| Mesmo número da Fase 3? | não verificável (Fase 3 inacessível, §4) | Bloqueado por acesso |
| Já aplicada em algum ambiente? | não verificável: sem acesso ao Neon. A entrega declara que **não tem banco criado** (§5 do doc); o pacote diz que só foi aplicada em bancos descartáveis | Bloqueado por acesso |
| Schema do código × migrations | consistentes (`drizzle-kit generate`: sem mudanças) | Validado localmente |
| Schema do código × banco real | não verificável | Bloqueado por acesso |

**Procedimento proposto** (para autorização):
1. **Impacto:** baixo; só uma tabela nova.
2. **Dependências:** 0000–0005 aplicadas; PostgreSQL 13+ (`gen_random_uuid` nativo; o Neon atende).
3. **Ordem:** num banco novo da entrega, 0000 → 0006 numa execução de `pnpm db:migrate`. Num banco existente, só a
   0006.
4. **Verificações prévias:**
   - conferir o **host** da `DATABASE_URL` (precisa ser o banco da entrega, nunca o do V0-saas);
   - `select * from drizzle.__drizzle_migrations order by created_at` para ver o histórico real;
   - conferir que `service_credentials` não existe.
5. **Aplicação:** criar um branch/ponto de restauração no Neon e rodar `pnpm db:migrate` com a URL **direta**
   (não pooled).
6. **Validação:**
   - `\d service_credentials`, com índices e FK;
   - nova linha em `__drizzle_migrations`;
   - a 2ª execução não faz nada.
7. **Recuperação:** `DROP TABLE service_credentials;` e remover a linha correspondente de
   `drizzle.__drizzle_migrations` (só se nenhuma credencial estiver em uso), ou restaurar o branch do Neon.

---

## 10. Variáveis necessárias na Vercel

Não há projeto Vercel vinculado nem acesso a ele daqui, então **a existência de cada variável não pôde ser
verificada** (`Bloqueado por acesso`). A entrega ainda não foi publicada, então **todas** precisam ser criadas no
projeto da entrega.

**Novas, introduzidas pela integração:**

| Nome | Finalidade | Ambiente | Tipo | Área | Observação |
|---|---|---|---|---|---|
| `AUTH_ALLOWED_EMAILS` | e-mails autorizados a entrar | Production (e Preview, se houver) | não secreta, mas sensível (lista de pessoas) | login | pelo menos uma das duas listas; **antes** do deploy |
| `AUTH_ALLOWED_DOMAINS` | domínios autorizados (por exemplo, o da MSServer) | Production | não secreta | login | idem |
| `CRON_SECRET` | autentica o Vercel Cron em `/api/cron/sync` | Production | **secreta**, 32+ caracteres | sincronização | sem ela a rota responde 503 (desligada) |
| `SCHEDULED_SYNC_WORKSPACE_IDS` | uuids dos workspaces sincronizados todo dia | Production | não secreta | sincronização | sem ela nada é sincronizado |
| `SCHEDULED_SYNC_BUDGET_SECONDS` | orçamento de uma execução (30–800) | Production | não secreta | sincronização | opcional; padrão 270; ajustar ao plano |

**Base da entrega, exigidas para a API funcionar** (já documentadas em `docs/entrega-ms-server.md` §3 e ainda não
configuradas):

| Nome | Tipo | Área | Observação |
|---|---|---|---|
| `DATABASE_URL` | secreta | banco | banco **da entrega**; nunca o do V0-saas |
| `AUTH_SECRET` | secreta | sessão | novo; nunca o do V0-saas (que pode ter sido exposto) |
| `AUTH_URL` | pública | sessão/links | domínio da entrega; obrigatório (F8) |
| `APP_ENCRYPTION_KEY` | secreta | cifra de tokens OAuth | nova |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | ID público / secret secreto | OAuth | client do projeto Google Cloud da MSServer |
| `GA4_REDIRECT_URI` | pública | OAuth GA4 | `https://<domínio>/api/oauth/ga4/callback` |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | não secreta | Google Ads | só se for via MCC |
| `META_*`, `RD_*` | secretas | OAuth | opcionais; a Gestão não usa Meta/RD nesta versão |
| `USE_MOCK=false`, `ADVISOR_*` | não secretas | — | como no doc |

**Região das funções:** o pacote sugere `gru1` (São Paulo) por o banco estar em `sa-east-1`. Isso vale para o
ambiente que a MSServer observou, que não é o da entrega. Definir quando o Neon da entrega for criado.
`Precisa de validação`

---

## 11. Estado e requisitos do OAuth GA4

Não há acesso ao Google Cloud: client ID/secret, redirect URIs, domínios e estado de publicação **não puderam ser
inspecionados**. `Bloqueado por acesso`

O que o código e a documentação estabelecem:

| Item | Estado | Classificação |
|---|---|---|
| Escopos | login `openid email profile`; GA4 `analytics.readonly`; Google Ads `adwords` (mesmo client) | Confirmado |
| Redirect URIs | `https://<domínio>/api/auth/callback/google`, `/api/oauth/ga4/callback`, `/api/oauth/google_ads/callback`; origem `https://<domínio>` | Confirmado |
| Domínio | **a definir** (§3 do doc) | Bloqueado por acesso |
| Modo "Testing" | refresh token do GA4 expira em cerca de 7 dias; limite de 100 usuários de teste | Confirmado (doc + pacote) |

Requisitos para colocar em **produção** (tipo de usuário "External"):
- `analytics.readonly` e `adwords` são escopos **sensíveis**. Publicar exige **verificação do Google**:
  - domínio verificado no Search Console;
  - página inicial e política de privacidade nesse domínio;
  - justificativa dos escopos e vídeo de demonstração.
- A verificação leva dias ou semanas. Sem ela, o app publicado mostra o aviso "app não verificado" e fica limitado a
  100 usuários.
- A expiração de 7 dias deixa de valer só quando o status é "In production".

**Alternativa recomendada no próprio doc (§4):**
- Se a MSServer usa Google Workspace, configurar a tela de consentimento como **Interna**. Isso dispensa
  verificação, não tem expiração de 7 dias e só aceita contas do domínio.
- Condição: as contas com acesso à propriedade GA4 e ao Google Ads precisam ser do domínio.

**Impacto nas contas conectadas:**
- Na entrega, **nenhuma** conta foi conectada, então não há impacto.
- Se a ideia for mudar o OAuth do **V0-saas**, isso está fora do escopo.
- Tokens emitidos em Testing **não** viram permanentes ao publicar: depois da publicação, cada fonte Google deve ser
  **reconectada uma vez**.

**Credenciais antigas (`SEGURANCA.md`):**
- O `.env` exposto é anterior à separação. Os segredos a renovar são, provavelmente, os do **V0-saas**: isso é uma
  ação no V0-saas, fora desta tarefa.
- A entrega deve nascer com segredos **novos** (política já escrita no §3), o que a protege desse vazamento.
- O procedimento de troca da `APP_ENCRYPTION_KEY` (chaves versionadas) é correto em linhas gerais, mas **não se
  aplica a uma instalação nova**.

Nada foi alterado.

---

## 12. Testes executados

Tudo foi executado no clone descartável, offline em relação a serviços reais, com variáveis sintéticas.

| Verificação | `main` da entrega | `main` + branch mesclada | Classificação |
|---|---|---|---|
| `pnpm test` (vitest) | 1362 aprovados / 38 pulados | **1401 aprovados / 44 pulados** (+39 novos; +6 pulados = `isolation-db`, opt-in) | Validado localmente |
| `pnpm lint` | — | sem erros (exit 0) | Validado localmente |
| `pnpm typecheck` | — | exit 0 depois do build. Antes do build falha por `PageProps`/`LayoutProps` (tipos gerados pelo Next; comportamento do projeto, não da branch) | Validado localmente |
| `pnpm build` | — | ok com variáveis sintéticas; rotas `/api/integration/v1/*` e `/api/cron/sync` dinâmicas. Sem variáveis, o build falha na validação de `env.ts` (comportamento existente) | Validado localmente |
| `drizzle-kit generate` | — | sem mudanças pendentes | Validado localmente |
| Teste HTTP (`next start` local) | — | sem token → 401 `missing_token` + `WWW-Authenticate`; malformado → 401 `invalid_token`; `Basic` → 401; POST → 405; cron sem `CRON_SECRET` → 503; **banco inacessível → 500 fora do contrato (F1)** | Validado localmente |
| `isolation-db.test.ts` (Postgres real) | — | **não executado**: sem Docker/Postgres nesta máquina | Precisa de validação |
| Script de credenciais contra banco | — | não executado (exige banco) | Precisa de validação |

**Cobertura existente:** autenticação (ausente, malformada, segredo errado, revogada, expirada, sem escopo),
isolamento (mock e Postgres real), parâmetros (datas, intervalo, `limit`, `period_days`, cursor), contrato, ausência
de texto bruto do provedor, log sem token, rate limit, 405, sync agendada (motivos de pulo, orçamento) e allowlist.

**Lacunas a cobrir:**
- falha do banco na autenticação (F1);
- dados desatualizados ou incompletos;
- dia sem dado × dia com zero;
- prova de execução de que a sync não chama endpoints de escrita dos provedores (hoje só por inspeção);
- teste de migração aplicando 0000–0006 num Postgres vazio e reaplicando.

Nenhum teste foi removido ou enfraquecido.

---

## 13. Riscos e bloqueios

| # | Tipo | Descrição | Classificação |
|---|---|---|---|
| B1 | **Bloqueio** | Ambiente-alvo indefinido: a entrega não tem projeto Vercel, banco Neon, domínio nem contas conectadas; o pacote pressupõe o ambiente do V0-saas | Requer autorização (decisão) |
| B2 | **Bloqueio** | Possível exposição de segredos do V0-saas de origem (`SEGURANCA.md`) e existência de uma cópia do V0-saas no servidor da MSServer | Requer autorização (tratar no V0-saas, fora desta tarefa) |
| B3 | Bloqueio parcial | Fase 3 inacessível: não dá para confirmar a ausência de colisão da 0006 | Bloqueado por acesso |
| B4 | Bloqueio parcial | Sem Postgres local descartável: isolamento real não verificado aqui | Precisa de validação |
| B5 | Bloqueio para dados reais | OAuth: tipo de usuário (Interna × Externa) e verificação Google | Requer autorização |
| R1 | Risco | Login fail-closed: publicar sem `AUTH_ALLOWED_*` tranca todos para fora | Precisa de validação |
| R2 | Risco | Cron num plano com `maxDuration` menor que 300 s: execução cortada; o orçamento padrão de 270 s exige plano Pro | Precisa de validação |
| R3 | Risco | A Gestão interpretar ausência como zero ou dado velho como atual (F2) | Precisa de validação |
| R4 | Risco | Token impresso em terminal e `DATABASE_URL` de produção em arquivo local (F3) | Requer autorização (procedimento) |
| R5 | Risco | Documentação da entrega desatualizada após a integração (escopo, `vercel.json`, política de acesso) | Confirmado |

---

## 14. Plano de publicação (não executado)

| # | Etapa | Pré-requisitos | Riscos | Evidência de conclusão | Exige autorização | Validação |
|---|---|---|---|---|---|---|
| 1 | Revisão e integração do código na entrega | aprovação deste relatório; decisão sobre incluir login e cron | merge leva mudanças de comportamento | branch `integracao/gestao-v1` importada do bundle e mesclada por PR no `entrega-msserver` | **sim** (merge) | diff igual ao auditado (`a0a4d53`) |
| 2 | Correções | etapa 1 | — | commits com F1, F2 (campos opcionais), F7/F8, script (F3) e docs da entrega atualizados | sim (escopo) | testes novos para cada correção |
| 3 | Testes locais | etapa 2 | — | `test`/`lint`/`typecheck`/`build` verdes + `isolation-db` num Postgres descartável + 0000–0006 num banco vazio | não | logs anexados ao PR |
| 4 | Revisão da migration | etapa 3; B3 esclarecido | colisão de numeração | SQL final aprovado | **sim** | — |
| 5 | Aplicação no Neon | **banco da entrega criado** (B1); branch de backup | aplicar no banco errado | linha em `__drizzle_migrations`; `\d service_credentials` | **sim** | 2ª execução sem efeito; host conferido |
| 6 | Variáveis na Vercel | projeto Vercel da entrega (B1); domínio | esquecer `AUTH_ALLOWED_*`; reaproveitar segredo do V0-saas | variáveis listadas em Settings (sem valores no relatório) | **sim** | deploy de Preview sobe; login autorizado entra e não autorizado é recusado |
| 7 | OAuth GA4 | domínio; decisão Interna × Externa; para Externa, verificação Google | atraso na verificação; reconexões | status "In production" (ou Interna) | **sim** | conexão GA4 feita e refresh funcionando após mais de 7 dias |
| 8 | Publicação da API | etapas 5–7 | — | deploy Production | **sim** | `/api/health` ok; `/api/integration/v1/health` sem token → 401 |
| 9 | Credencial exclusiva | etapa 8; procedimento F3 definido | vazamento na entrega do token | `listar` mostra `gestao-msserver` ativa, 180 dias | **sim** | `/health` com o token → 200 com o workspace certo |
| 10 | Validação controlada com dados reais | contas GA4/Google Ads conectadas no workspace da entrega; 1ª importação manual | dados incompletos no começo | checklist abaixo preenchido | **sim** | ver abaixo |
| 11 | Homologação com a Gestão | etapa 10; aceite da MSServer | Gestão consumir Meta, ou somar plataformas | sincronização da Gestão idempotente e telas conferidas | **sim** (ligar em produção) | comparação dos números lado a lado |
| 12 | Monitoramento e rollback | etapa 11 | — | 7 dias de cron com `success` | não | logs `integration_request`/`scheduled_sync` |

**Rollback:** revogar a credencial (corta a Gestão na hora), remover `CRON_SECRET` (desliga o cron), reverter o
deploy na Vercel (Instant Rollback) e, se necessário, `DROP TABLE service_credentials`. Nenhum dado de marketing
depende da tabela nova.

**Validação controlada (etapa 10), somente leitura:**
1. Credencial válida → 200; revogada, expirada ou outro token → 401; nenhum segredo nos logs da Vercel (buscar
   `v0s_` deve dar 0 ocorrências).
2. Workspace: criar uma 2ª credencial num workspace de teste e conferir que nenhuma rota devolve dados cruzados,
   mesmo com `?workspace_id=`.
3. Números: escolher 3 dias e 3 campanhas e comparar API × tela Campanhas × interface do Google Ads/GA4 (moeda,
   custo, conversões, sessões).
4. Diagnósticos: `severity`, `confidence`, `evidence` e `limitation` iguais aos de `/campanhas/diagnosticos` e
   `/diagnostico`.
5. Cron: aguardar 2 execuções (09:00 UTC) e conferir `last_synced_at` e os motivos dos pulos.
6. Falha: provocar `needs_reauth` num workspace de teste e conferir que `/sources` mostra o estado e a mensagem fixa.
7. Desatualização e incompletude: conferir como a Gestão exibe uma fonte sem importação há mais de 36 h (exige F2).
8. Escrita externa: nenhuma chamada `mutate` nos logs; o histórico de alterações do Google Ads sem eventos do app.

---

## 15. Ações que exigem sua autorização

1. Decidir o **ambiente-alvo** da integração (projeto Vercel e banco Neon **da entrega**) e quem cria cada um (B1).
2. Tratar o **possível vazamento** de segredos do V0-saas de origem, separadamente e no V0-saas (B2).
3. Disponibilizar a Fase 3 (`fase-3-inteligencia`/`4662006`) ou confirmar que ela não entra na entrega (B3).
4. Incluir ou não os commits de **login por lista** e de **sync agendada**.
5. Aprovar as correções F1–F8 e o contrato complementar (§5).
6. Mesclar a branch no `entrega-msserver` (PR) e fazer push.
7. Aplicar as migrations 0000–0006 no Neon da entrega.
8. Criar as variáveis na Vercel.
9. Escolher Interna × Externa no OAuth, iniciar a verificação Google e publicar.
10. Fazer o deploy de produção.
11. Emitir a credencial `gestao-msserver` e definir o canal de entrega do token.
12. Conectar as contas reais (GA4, Google Ads) e importar.
13. Fazer a validação controlada e ligar a Gestão em produção.

---

## 16. Decisão final

1. **A branch é compatível com a entrega?** Tecnicamente, sim. Base `01bd416` (a mesma da entrega), merge sem
   conflitos, 1401 testes, lint, typecheck e build ok, schema consistente. Mas ela foi preparada para o V0-saas, e
   2 dos 5 commits mudam login e importação além da API.
2. **O que falta para integrar?**
   - sua decisão sobre login e cron;
   - correções F1 e F2 (e, idealmente, F3, F7 e F8);
   - atualizar `docs/entrega-ms-server.md`;
   - rodar `isolation-db` num Postgres descartável;
   - PR revisado.
3. **A API expõe só o autorizado?** Expõe só indicadores, estados e diagnósticos: sem tokens, segredos, erros
   brutos nem `raw_records`. Mas entrega **Meta e RD** (a Gestão só usa GA4 e Google Ads) e o **nome do workspace**.
   Recomendo restringir.
4. **Há risco de acesso entre workspaces?** Não por construção: o workspace vem só da credencial, e todas as
   consultas filtram por ele. Está coberto por testes simulados. A prova com Postgres real ainda precisa rodar.
5. **A 0006 está pronta para revisão de aplicação?** Sim: é aditiva, não toca dados existentes e tem recuperação
   simples. Pendências: confirmar a ausência de colisão com a Fase 3 e se ela já foi aplicada em algum banco; e
   existir o banco da entrega.
6. **Variáveis na Vercel:** novas, `AUTH_ALLOWED_EMAILS` e/ou `AUTH_ALLOWED_DOMAINS`, `CRON_SECRET`,
   `SCHEDULED_SYNC_WORKSPACE_IDS` e (opcional) `SCHEDULED_SYNC_BUDGET_SECONDS`. Além delas, todas as variáveis base
   da entrega (`DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`, `APP_ENCRYPTION_KEY`, `GOOGLE_OAUTH_*`,
   `GA4_REDIRECT_URI`…), porque o projeto da entrega ainda não existe na Vercel.
7. **OAuth GA4 em produção:** faltam domínio, decisão Interna × Externa e, se Externa, verificação Google dos
   escopos sensíveis (`analytics.readonly`, `adwords`). Depois disso, reconectar as fontes Google.
8. **Testes pendentes:**
   - `isolation-db` em Postgres descartável;
   - migrações 0000–0006 num banco vazio;
   - script de credencial num banco descartável;
   - testes novos para F1 e F2;
   - validação controlada com dados reais (etapa 10).
9. **Há bloqueador para a validação controlada?** Sim: B1 (não há instância da entrega publicada, com banco e contas
   conectadas) e B5 (OAuth). B2 deve ser resolvido antes de qualquer uso de dados reais.
10. **Sequência recomendada:** resolver B1, B2 e B3 → decidir sobre login e cron → PR com a branch + correções +
    docs → testes locais com Postgres descartável → criar Neon e Vercel da entrega → migrations → variáveis → OAuth →
    deploy → credencial → conectar contas e importar → validação controlada → homologação com a Gestão →
    monitoramento (§14).
