# 08 — Sequências de comandos e rollback

## Windows (PowerShell) — projeto em `C:\Users\User\Desktop\CRM\Projeto_CRM\Projeto_CRM-homologation`
Não remova o container `isp-crm-postgres` e nunca use `docker compose down -v`.

```powershell
cd C:\Users\User\Desktop\CRM\Projeto_CRM\Projeto_CRM-homologation
git fetch origin cursor/vertice-foundation-edc0
git checkout cursor/vertice-foundation-edc0
git pull origin cursor/vertice-foundation-edc0
npm install
docker start isp-crm-postgres            # se já existir; senão: docker compose up -d postgres
.\scripts\backup-database.ps1            # antes de migrar
npm run dev:web:funnel                   # Next :3000 + worker (alias do fluxo único)
```
Abra `http://localhost:3000`. Para os testes de integração, defina antes um PostgreSQL **de teste**:
```powershell
$env:TEST_DATABASE_ADMIN_URL = "postgresql://USUARIO:SENHA@localhost:PORTA/postgres"
npm run test:all-local
```
Status de validação em Windows: **não executado nesta sessão** (ambiente Linux). O job `windows` do CI cobre
apenas type-check, testes unitários, validação estática e build.

## Linux / macOS
```bash
git checkout cursor/vertice-foundation-edc0 && npm ci
docker compose up -d postgres
export TEST_DATABASE_ADMIN_URL="postgresql://USUARIO:SENHA@localhost:PORTA/postgres"
npm run test:all-local     # unit, harness, migrations, funil, inbox, registros, outbox, E2E
npm run dev                # site único
```

## Rollback
- Código: `git checkout <SHA anterior>` (a branch não é reescrita; sem force-push).
- Banco: as migrations `20261029100000` e `20261029110000` são aditivas. Para voltar ao código anterior
  basta não usá-las; colunas/tabelas novas são ignoradas pelo código antigo. Restaure `scripts/backup-database.ps1`
  apenas se houver corrupção. Não edite `_prisma_migrations`.
- Fluxo legado: `npm run dev:legacy-api` com `LEGACY_API_ENABLED=true` (e `SGP_LEGACY_SYNC_ENABLED=true` se precisar do SGP).
