# Vértice — plataforma de atendimento, CRM e automação

Nome provisório. Marca e tema ficam centralizados em `apps/web/src/lib/brand.ts` e
`apps/web/src/app/theme.css` (um teste garante que os dois não divergem).

Este diretório documenta a construção **incremental** sobre o repositório existente
(ISP CRM SaaS: Next.js + NestJS + Prisma + PostgreSQL + Redis). Nada foi substituído.

| Arquivo | Conteúdo |
|---|---|
| [01-baseline-e-decisoes.md](01-baseline-e-decisoes.md) | Estado encontrado, decisões, conflitos de regras, riscos |
| [02-matriz-requisitos-evidencias.md](02-matriz-requisitos-evidencias.md) | 22 módulos, estado real e evidência de cada um |
| [03-modelo-de-dados-e-invariantes.md](03-modelo-de-dados-e-invariantes.md) | Tabelas novas, invariantes de concorrência, rotas |
| [04-registro-de-continuidade.md](04-registro-de-continuidade.md) | Checkpoint: o que existe, comandos, resultados, próxima ação |

## Como rodar (site único)

Procedimentos completos (PowerShell, Linux, rollback): [08-sequencias-de-comandos-e-rollback.md](08-sequencias-de-comandos-e-rollback.md).

```powershell
npm install
docker compose up -d postgres
npm run dev:web:funnel      # alias de `npm run dev`: Next :3000 + worker; sem NestJS/SGP
```

## Testes (nenhum toca o banco de desenvolvimento; exigem TEST_DATABASE_ADMIN_URL)

```bash
npm run typecheck && npm test               # unidade + site único
npm run test:harness                        # harness de banco descartável
npm run prisma:validate:migrations          # migrations: limpa, divergência, atualização legada
npm run test:sales-funnel-integration
npm run test:inbox-integration
npm run test:records-integration
npm run test:outbox-integration             # outbox, worker, webhook HMAC, SSE
npm run test:site-e2e                       # prova de independência (sem SGP/NestJS)
npm run test:legacy-api                     # API NestJS legada (opt-in)
```

| Arquivo | Conteúdo (correção "site único") |
|---|---|
| [05-baseline-causas-e-correcoes.md](05-baseline-causas-e-correcoes.md) | Baseline, causas confirmadas e correções |
| [06-site-unico-mapa-de-rotas.md](06-site-unico-mapa-de-rotas.md) | Layout, tema, rotas e permissões |
| [07-desacoplamento-sgp-inventario.md](07-desacoplamento-sgp-inventario.md) | O que saiu do caminho operacional |
| [08-sequencias-de-comandos-e-rollback.md](08-sequencias-de-comandos-e-rollback.md) | PowerShell, Linux, rollback |
| [09-prova-de-independencia.md](09-prova-de-independencia.md) | Como a independência é provada e seus limites |
| [10-comparacao-de-branches.md](10-comparacao-de-branches.md) | Branches comparadas, sem merge |
