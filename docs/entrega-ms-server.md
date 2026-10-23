# Entrega MS Server — instalação própria

> Este repositório é a **versão entregue à MS Server**: uma cópia independente do projeto de origem (SaaS), tirada no
> commit `01bd416` (tag `origem-saas-01bd416`), com as Fases 1 e 2 da solução de tráfego pago. Depois da separação,
> **não recebe automaticamente** nada do SaaS: qualquer atualização futura é uma decisão explícita (ver §11).

## 1. Escopo funcional entregue

| Área | O que faz | Estado |
|---|---|---|
| **Diagnóstico** (`/diagnostico`) | Motor determinístico sobre o GA4: quedas de tráfego/conversão, qualidade de dados, estado das fontes e mídia paga dos últimos 28 dias | implementado |
| **Campanhas** (`/campanhas`) — Fase 1 | Google Ads e Meta Ads lado a lado: período, comparação com o período anterior, filtros, cobertura real da importação, detalhe campanha → grupo/conjunto → anúncio | implementado |
| **Diagnóstico de campanhas** (`/campanhas/diagnosticos`) — Fase 2 | Regras determinísticas (sem IA): investimento sem resultados, custo por resultado, CTR, CPC, queda de resultados, distribuição do investimento e limitações dos dados; severidade × confiança separadas | implementado |
| **Advisor** (`/advisor`) | Respostas determinísticas sobre o diagnóstico e o Cross-source já calculados; o modo com LLM existe e está **desligado** | implementado (LLM desligado) |
| **Conexões** (`/conexoes`) | OAuth e importação manual: GA4, Google Ads, Meta Ads, RD Station Marketing, RD Station CRM | implementado; contas da MS Server **a conectar** nesta instalação |

Detalhes técnicos e decisões: `PROJECT_STATE.md` (§19 Fase 1, §20 Fase 2, §21 esta separação) e
`docs/v1-architecture.md` (invariantes INV-1 a INV-26).

**O que NÃO está nesta entrega:** Fase 3 em diante (qualidade comercial, CRM × campanhas, criativos, histórico de
decisões), cobrança, convites/múltiplos usuários num mesmo workspace, importação agendada.

## 2. Arquitetura e dependências

- Next.js 16 (App Router) + React 19, TypeScript, Tailwind v4 + shadcn/ui (Base UI), Drizzle ORM sobre PostgreSQL,
  Auth.js (login Google, sessão JWT), Zod, Vitest. Gerenciador: pnpm (Corepack, versão travada em `package.json`).
- Um único app (servidor + interface). Importações rodam **dentro da requisição** de "Importar dados" (sem fila).
- Tokens de terceiros ficam **cifrados** no banco (AES-256-GCM, chave `APP_ENCRYPTION_KEY`).
- Licenças das dependências de produção (levantamento de `pnpm licenses list --prod`, 2026-10-23): majoritariamente
  MIT, Apache-2.0, ISC e BSD; `postgres` (Unlicense); `caniuse-lite` (CC-BY-4.0); `@img/sharp-libvips` (**LGPL-3.0**,
  dependência transitiva do Next para imagens, carregada como biblioteca nativa). O projeto **não tem arquivo
  `LICENSE`**. **A titularidade e o licenciamento do código entre o desenvolvedor e a MS Server não estão definidos
  neste repositório** — isso depende do contrato entre as partes e não foi tratado aqui.

## 3. Variáveis de ambiente (sem valores)

Defina-as na Vercel (Project → Settings → Environment Variables, ambiente **Production**) e, para desenvolvimento, em
`.env.local` (nunca versionado). Referência completa e comentada: `.env.example`.

| Variável | Obrigatória | Valor em produção |
|---|---|---|
| `DATABASE_URL` | sim | conexão Postgres **do banco da MS Server** (conexão direta, `sslmode=require`) |
| `AUTH_SECRET` | sim | gerar novo: `openssl rand -base64 32` (nunca reaproveitar o do SaaS) |
| `AUTH_URL` | sim em produção | `https://<domínio da MS Server>` — **a definir** |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | sim | client OAuth **do projeto Google Cloud da MS Server** |
| `GA4_REDIRECT_URI` | sim em produção | `https://<domínio>/api/oauth/ga4/callback` |
| `APP_ENCRYPTION_KEY` | sim | gerar nova: `openssl rand -base64 32` — **guardar com cuidado**: perdê-la invalida os tokens salvos (é só reconectar) |
| `USE_MOCK` | não | `false` |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | não | vazio (descontinuado pela Google em 09/09/2026) |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | não | id do MCC da MS Server, só se as contas forem acessadas via Manager |
| `META_APP_ID` / `META_APP_SECRET` / `META_LOGIN_CONFIG_ID` | não | app Meta **da MS Server** (sem eles, Meta Ads aparece como não configurado) |
| `RD_MARKETING_CLIENT_ID` / `RD_MARKETING_CLIENT_SECRET` | não | app privado RD Station Marketing **da MS Server** |
| `RD_CRM_CLIENT_ID` / `RD_CRM_CLIENT_SECRET` | não | app privado RD Station CRM **da MS Server** |
| `ADVISOR_ENABLED` | não | `true` (determinístico) |
| `ADVISOR_LLM_ENABLED` / `ANTHROPIC_API_KEY` | não | `false` / vazio — o modo LLM nunca foi validado com geração real e gera custo |

**Isolamento:** esta instalação **não deve** usar o banco, o `AUTH_SECRET`, a `APP_ENCRYPTION_KEY` nem os apps OAuth
do SaaS de origem. Cada um é criado do zero, sob contas da MS Server.

## 4. Autenticação, OAuth e URLs de callback

Cadastre exatamente estas URLs (troque `<domínio>`; sem barra final):

| Onde | URL |
|---|---|
| Google Cloud → OAuth client (Web) → Authorized redirect URIs | `https://<domínio>/api/auth/callback/google` · `https://<domínio>/api/oauth/ga4/callback` · `https://<domínio>/api/oauth/google_ads/callback` |
| Google Cloud → Authorized JavaScript origins | `https://<domínio>` |
| Meta for Developers → Facebook Login → URIs de redirecionamento | `https://<domínio>/api/oauth/meta_ads/callback` |
| RD App Publisher → app Marketing | `https://<domínio>/api/oauth/rd_station_marketing/callback` |
| RD App Publisher → app CRM | `https://<domínio>/api/oauth/rd_station_crm/callback` |

APIs a habilitar no projeto Google Cloud: Google Analytics Data API, Google Analytics Admin API, Google Ads API.
Escopos pedidos: login (`openid email profile`), GA4 (`analytics.readonly`), Google Ads (`adwords`), Meta (`ads_read`).

### Política de acesso (importante)

O login aceita **qualquer conta Google** que o OAuth permitir, e cada pessoa recebe **o próprio workspace** (não há
convites nem workspace compartilhado nesta versão — isso é funcionalidade futura). Para restringir quem entra **sem
mudar código**:
- **Recomendado:** se a MS Server usa Google Workspace, configure a tela de consentimento OAuth como **Interna** —
  só contas do domínio da empresa conseguem logar.
- Alternativa: deixar o app OAuth em **Testing** com a lista de usuários de teste (limite de 100; o refresh token do
  GA4 expira em ~7 dias nesse modo — já observado no piloto).

Como cada usuário tem o próprio workspace, **a pessoa que conectar as contas é a que vê os dados**. Defina quem será
o usuário responsável antes de conectar.

## 5. Banco de dados e migrações

- Banco **novo e vazio** da MS Server (ex.: projeto próprio no Neon, na conta da empresa).
- Migrações versionadas em `src/server/db/migrations/` (0000 → 0005). Num banco novo:
  ```bash
  DATABASE_URL=<banco da MS Server> pnpm db:migrate
  ```
  Verificado em 2026-10-23 num Postgres 16 vazio descartável: as 6 migrações aplicam (14 tabelas) e uma 2ª execução
  não faz nada. A 0005 (`fact_ad_entity_daily`) é aditiva e necessária para o detalhe por grupo/conjunto e anúncio.
- **A Vercel não aplica migrações.** Aplique antes (ou logo depois) do primeiro deploy, sempre com a URL do banco da
  MS Server em mãos — confira o host antes de rodar.
- Backup: ative o histórico/ponto de restauração do provedor (no Neon, *point-in-time restore*) antes de qualquer
  migração futura.

### Dados do piloto (decisão pendente)

O piloto foi operado no banco do projeto de origem. **Nenhum dado foi copiado para esta entrega** (nem dumps, nem
tokens). Numa instalação nova, a primeira importação recupera: GA4 e Google Ads até ~180 dias; Meta Ads até ~180 dias;
RD CRM pelo histórico da API; **RD Station Marketing só os últimos 45 dias** (limite da API). Se a MS Server quiser o
histórico anterior do RD Marketing, ele existe apenas no banco de origem e exige uma exportação **autorizada** — e,
depois da entrega, os dados da MS Server no banco de origem devem ter destino definido (manter, transferir ou apagar),
por decisão das partes.

## 6. Conectar as contas autorizadas

Depois do deploy, com o usuário responsável logado:
1. **Conexões → GA4**: conectar com uma conta Google com acesso de leitura à propriedade; escolher a propriedade;
   "Atualizar dados".
2. **Google Ads**: conectar (conta com acesso às contas de anúncios; o projeto Google Cloud precisa de acesso à
   Google Ads API); escolher a conta; "Importar dados" — traz campanhas e, com a 0005, grupos e anúncios.
3. **Meta Ads**: exige o app Meta configurado (§3/§4) e a pessoa com papel no app ou "Acesso avançado" a `ads_read`;
   conectar, escolher a conta de anúncios, importar. O acesso dura ~60 dias; a tela avisa antes de expirar.
4. **RD Station Marketing / CRM**: conectar cada produto (apps separados) e importar.
5. Conferir em **Campanhas** e **Diagnóstico de campanhas** que as plataformas aparecem como importadas e com o
   período coberto.

Nenhuma conta da MS Server foi conectada a esta instalação durante a preparação.

## 7. Deploy (Vercel) e domínio

1. Crie o repositório Git da MS Server (privado, na conta/organização que a empresa indicar) e envie este repositório:
   `git remote add origin <url>` e `git push -u origin main --tags`.
2. Na Vercel da MS Server: *Add New Project* → importe o repositório (framework Next.js detectado; build `next build`;
   instalação `pnpm install`). Não há `vercel.json`.
3. Cadastre as variáveis do §3 no ambiente Production.
4. Aplique as migrações (§5).
5. Domínio: *Settings → Domains* → adicione o domínio da MS Server e configure o DNS indicado pela Vercel; depois,
   ajuste `AUTH_URL`, `GA4_REDIRECT_URI` e as URLs do §4 para esse domínio.
6. Faça o deploy e confira `https://<domínio>/api/health` → `{"status":"ok","service":"ms-server-marketing",…}`.
7. **Duração das importações:** elas rodam dentro da requisição. A primeira importação (180 dias, com grupos e
   anúncios) pode passar do limite de tempo de funções do plano da Vercel; confira o limite do plano contratado e, se
   necessário, importe em mais de uma rodada (o sync é incremental e retoma de onde parou).

## 8. Manutenção e atualização

- Verificações locais: `pnpm typecheck`, `pnpm lint`, `pnpm test` (offline), `pnpm build`.
- Nova migração: `pnpm db:generate` → revisar o SQL → aplicar com backup.
- Tokens: Meta a cada ~60 dias (reconectar); GA4 em modo Testing a cada ~7 dias.
- RD Station Marketing: importar ao menos a cada 45 dias para não perder dias.

## 9. Identidade visual (pendente)

Aplicado: o nome **"MS Server"** na barra lateral, no login e nos títulos das páginas, centralizado em `src/brand.ts`.
**Não aplicado, por falta de material oficial** (nada foi inventado):

| Item | Onde entra | O que a MS Server precisa fornecer |
|---|---|---|
| Logotipo | `public/brand/` + `logo` em `src/brand.ts` | arquivo oficial (SVG de preferência; PNG em alta), versão para fundo claro |
| Cores | bloco "MARCA" em `src/app/globals.css` (`--primary`, `--sidebar-*`, `--ring`, `--chart-*`) | paleta oficial (hex) e cor principal de ação |
| Tipografia | `src/app/layout.tsx` (hoje Geist) | fonte oficial e licença de uso na web |
| Nome do produto | `productName` em `src/brand.ts` | se houver um nome além de "MS Server" |
| Favicon | `src/app/` | ícone oficial |

## 10. Limitações conhecidas

- Integrações **não validadas nesta instalação**: nenhuma conta foi conectada; testes usaram respostas simuladas e um
  banco sintético descartável. Meta Ads nunca foi conectado com um app real no projeto de origem.
- Limiares do diagnóstico de campanhas ainda não calibrados com dados reais (`src/server/campaigns/diagnostics/thresholds.ts`).
- Um usuário por workspace; sem convites; sem papéis efetivos.
- Importação manual (sem agendamento); Meta não informa status de campanha; Performance Max sem grupos de recursos.
- Advisor com LLM desligado e nunca validado com geração real.

## 11. Diferenças em relação ao SaaS independente

| | Esta entrega (MS Server) | SaaS de origem |
|---|---|---|
| Base | commit `01bd416` (Fases 1 e 2) | continua evoluindo (Fases 3, 4, 5…) |
| Repositório | próprio, sem remote apontando para o SaaS | `NicolasUxSilva/V0-saas` (intacto) |
| Marca | "MS Server" via `src/brand.ts` | identificador provisório `v0-saas` |
| Banco, OAuth, segredos | próprios da MS Server | próprios do SaaS |
| Correções após a separação | `EmptyState` aceita ícone renderizado (§21 do PROJECT_STATE) | a mesma correção ainda não aplicada |
| Atualizações futuras | só por decisão explícita (cherry-pick revisado) | — |
