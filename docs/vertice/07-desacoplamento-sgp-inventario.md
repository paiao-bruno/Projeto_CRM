# 07 — Inventário do desacoplamento SGP / NestJS

Princípio: **não apagar** tabelas, credenciais ou histórico SGP. O SGP deixa de estar no caminho
operacional e passa a ser opt-in.

| Área | Antes | Agora |
|---|---|---|
| `npm run dev` / `dev:web` / `dev:web:funnel` | API NestJS (:4000) ou web-only com "modo web-only" | `scripts/dev-site.mjs`: Next (:3000) + worker da outbox. Sem NestJS. |
| `apps/api` | Obrigatório no fluxo completo | Legado opt-in: `dev:legacy-api`, `build:legacy-api`, `test:legacy-api`, `typecheck:legacy-api`. `main.ts` exige `LEGACY_API_ENABLED=true`. |
| Agendador SGP (`SgpAutoSyncScheduler`) | Ligado por `SGP_AUTO_SYNC_ENABLED` | Também exige `SGP_LEGACY_SYNC_ENABLED=true`; padrão inativo. |
| Clientes, contratos, faturas, agentes, dashboard | Dependiam de `/sgp/*` e da API | Serviços locais no Next, `origin="LOCAL"`, `externalId` nulo. Registros SGP existentes continuam legíveis. |
| `.env.example` | `SGP_*`, `NEXT_PUBLIC_API_URL`, flags web-only | Sem `SGP_*` no fluxo padrão; seção "legado" separada. |
| `docker-compose.yml` | postgres + redis | postgres; redis só com `--profile legacy`. |
| Redis | Fila/tempo real | Não usado. Fila = outbox em PostgreSQL; tempo real = LISTEN/NOTIFY + SSE. Testes de Redis: **não aplicável**. |
| Health | Dependia da API | `/api/health` informa `mode: single-site` e estado do banco. |
| Telas | `legacy-api-unavailable`, `web-only-empty-states` | Removidas. |

Schema: tabelas `Sgp*` e colunas `externalId` permanecem. A migration `20261029100000` só adiciona
(`origin`, `externalId` anulável, índices); nada é removido ou reescrito.

Pendência: a decisão de aposentar definitivamente o módulo SGP (código e tabelas) é do usuário.
