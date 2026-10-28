# Vértice — plataforma de atendimento, CRM e automação

Nome provisório. Marca e tema ficam centralizados em `apps/web/src/lib/brand.ts` e
`apps/web/src/app/(vertice)/vertice.css` (um teste garante que os dois não divergem).

Este diretório documenta a construção **incremental** sobre o repositório existente
(ISP CRM SaaS: Next.js + NestJS + Prisma + PostgreSQL + Redis). Nada foi substituído.

| Arquivo | Conteúdo |
|---|---|
| [01-baseline-e-decisoes.md](01-baseline-e-decisoes.md) | Estado encontrado, decisões, conflitos de regras, riscos |
| [02-matriz-requisitos-evidencias.md](02-matriz-requisitos-evidencias.md) | 22 módulos, estado real e evidência de cada um |
| [03-modelo-de-dados-e-invariantes.md](03-modelo-de-dados-e-invariantes.md) | Tabelas novas, invariantes de concorrência, rotas |
| [04-registro-de-continuidade.md](04-registro-de-continuidade.md) | Checkpoint: o que existe, comandos, resultados, próxima ação |

## Como rodar (modo web-only, já usado no projeto)

PowerShell (Windows), a partir da raiz do projeto:

```powershell
git fetch origin
git checkout cursor/vertice-foundation-edc0
npm install
docker compose up -d postgres
.\scripts\backup-database.ps1          # recomendado antes de migrar (migration é aditiva)
npm run dev:web:funnel                 # aplica migrations e sobe o Next.js em :3000
```

Entre com o administrador já criado por `bootstrap:web-only` e abra
`http://localhost:3000/inbox`. O menu legado **não foi alterado**; a caixa de entrada é
acessada pela URL `/inbox` (um link no menu é uma decisão pendente do usuário).

## Testes (nenhum toca o banco de desenvolvimento)

```bash
npm run typecheck
npm test -w apps/web                       # unidade (regras, marca/tema)
npm run test:inbox-integration             # PostgreSQL descartável: concorrência, replay, isolamento
npm run test:inbox-e2e                     # Next.js real + HTTP + PostgreSQL descartável
```

Os dois últimos criam/recriam apenas bancos `vertice_inbox_test` / `vertice_inbox_e2e`
(guardas em `scripts/lib/disposable-db.mjs`: host local, nome com `test`/`_e2e`,
`ALLOW_DISPOSABLE_DB=true`). Defina `INBOX_TEST_ADMIN_URL` para a conexão administrativa
(`postgresql://USUARIO:SENHA@localhost:5432/postgres`). O padrão `crm:crm` é o do `docker-compose.yml`.
Sem `vector` instalado, as migrations de teste trocam `vector(1536)` por `TEXT`
(só em banco descartável).
