# 11 — Relatório final (estado real por entrega)

Classes: **A** executado e aprovado · **F** executado e falhou · **I** inspecionado estaticamente · **B** bloqueado / não executado.
Ambiente de execução: Linux, Node 22, PostgreSQL 16 com pgvector (instância descartável local; banco de desenvolvimento não tocado).
Logs em [evidence/](evidence/).

| Item | Causa confirmada | Arquivos alterados | Comando/teste | Resultado real | Evidência | Pendência |
|---|---|---|---|---|---|---|
| A1 funil-integration | Sintaxe TS em `.mjs` + banco não descartável | `scripts/test-sales-funnel-integration.mjs`, `scripts/lib/test-db-harness.mjs` | `npm run test:sales-funnel-integration` | A | `evidence/test_sales-funnel-integration.log` | — |
| A1 validate:migrations | Falso positivo sem `DATABASE_URL`; shadow incorreto | `scripts/validate-prisma.mjs`, `scripts/lib/migration-checks.mjs` | `npm run prisma:validate:migrations` | A | `evidence/prisma_validate_migrations.log` | — |
| A1 harness (negativos) | — | `scripts/test-harness.spec.mjs` | `npm run test:harness` | A (14/14) | `evidence/test_harness.log` | — |
| A2 serviços locais | Telas dependiam de `/sgp/*` | `apps/web/src/server/{records,ai-agents,dashboard}.ts`, rotas `api/*`, migration `20261029100000` | `npm run test:records-integration` | A (9/9) | `evidence/test_records-integration.log` | Sem emissão/cobrança (fora de escopo) |
| A3 site único | Dois shells e dois temas | `components/app-shell.tsx`, `app/theme.css`, páginas `(app)/*` | `npm test`, `test:unified-site`, capturas | A (6/6 unit + 6/6 spec); capturas inspecionadas | `evidence/test_unit.log`, artefatos de captura | Revisão visual de `/flows`, `/campaigns`, `/schedule` apenas por build |
| A4 independência do SGP | Fluxo padrão chamava SGP/NestJS | `scripts/dev-site.mjs`, `.env.example`, `docker-compose.yml`, `apps/api/*` guards | `npm run test:site-e2e` | A (guard de rede vazio, porta 4000 livre) | `evidence/site-e2e.log` | Guard cobre só processos Node |
| B1 outbox + worker | — | `server/outbox/*`, `OutboundDelivery`, `WorkerHeartbeat`, migration `20261029110000` | `npm run test:outbox-integration` | A (30/30) | `evidence/test_outbox-integration.log` | Sem adaptador de provedor real |
| B2 webhook HMAC | — | `server/webhook.ts`, `api/webhooks/inbound/*` | outbox-integration + E2E (401/401/200/dup/413) | A | idem | Homologação com provedor real: B |
| B3 tempo real | — | `server/realtime.ts`, `api/realtime/stream`, `lib/realtime-client.ts` | outbox-integration, E2E, unit | A | idem | Fallback por polling testado só por unit |
| Inbox / regressão | — | `server/inbox/service.ts` | `npm run test:inbox-integration` | A (19/19) | `evidence/test_inbox-integration.log` | — |
| Typecheck web / API legada | Contexto opcional em `route()`; tipos `externalId` | `server/route-kit.ts`, `apps/api/*` | `npm run typecheck`, `typecheck:legacy-api` | A | `evidence/typecheck*.log` | — |
| API legada | Agendador agora opt-in | spec do agendador | `npm run test:legacy-api` | A (138/138) | `evidence/test_legacy-api.log` | — |
| Build de produção | Type-check de rotas do Next | `server/route-kit.ts` | `npm run build` (também dentro do E2E) | A | `evidence/site-e2e.log` | — |
| CI | Inexistente | `.github/workflows/ci.yml` | execução remota | I (YAML escrito; scripts que ele chama foram executados localmente) | — | Primeira execução remota pendente; job Windows não roda integração |
| Validação em Windows | — | — | — | B (não executado) | — | Executar a sequência do doc 08 |
| Redis | — | — | — | Não aplicável (removido do fluxo) | doc 07 | — |
| Homologação SGP/provedores reais | — | — | — | B (sem credenciais; mensagens reais proibidas) | — | Usuário |
| 22 módulos do prompt original | — | — | — | Não declarados concluídos; ver doc 02 | doc 02 | Módulos restantes |

Git: trabalho em `cursor/vertice-foundation-edc0` (PR #5), sem force-push, merge ou rebase; `main` intocada.
Comparação de branches: [10](10-comparacao-de-branches.md).
