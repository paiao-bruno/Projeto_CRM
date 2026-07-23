# Checklist de Deploy em Produção — ISP CRM SaaS

Este documento descreve a ordem correta para o **primeiro deploy** em produção.

## Pré-requisitos

- PostgreSQL 16+ com extensões **pgcrypto** e **vector** (imagem `pgvector/pgvector:pg16`)
- Redis (recomendado para filas futuras; rate limit atual é in-memory)
- Node.js 20+
- Domínio HTTPS configurado (`APP_URL`, `CORS_ORIGINS`)
- Secrets gerados (mín. 32 caracteres): `JWT_ACCESS_SECRET`, `ENCRYPTION_KEY`

## 1. Variáveis de ambiente (produção)

Copie `.env.example` → `.env` e configure:

| Variável | Obrigatória | Exemplo |
|---|---|---|
| `NODE_ENV` | Sim | `production` |
| `APP_URL` | Sim | `https://crm.seudominio.com` |
| `NEXT_PUBLIC_API_URL` | Sim | `https://api.seudominio.com/api` |
| `DATABASE_URL` | Sim | `postgresql://...` |
| `JWT_ACCESS_SECRET` | Sim | 32+ chars aleatórios |
| `ENCRYPTION_KEY` | Sim | 32+ chars aleatórios |
| `CORS_ORIGINS` | Sim | `https://crm.seudominio.com` |
| `AUTO_SEED_DEMO` | Sim | `false` |
| `SGP_AUTO_SYNC_ENABLED` | Opcional | `true` |

**Nunca** use `CORS_ORIGINS=*` com credenciais habilitadas.

## 2. Ordem de execução

### 2.1 Banco de dados

```bash
# Subir PostgreSQL (Docker)
docker compose up -d postgres

# Validar migrations (banco vazio)
npm run db:test-migrate-deploy

# Aplicar migrations em produção
npm run db:migrate:deploy

# Gerar Prisma Client
npm run prisma:generate
```

### 2.2 Build

```bash
npm ci
npm run typecheck
npm run test
NODE_ENV=production npm run build
npm audit --workspaces
```

### 2.3 Inicialização

**API:**

```bash
cd apps/api
NODE_ENV=production node dist/main.js
```

**Frontend:**

```bash
cd apps/web
NODE_ENV=production npm run start
```

Ou use o process manager de sua preferência (systemd, PM2, Kubernetes, etc.).

## 3. Verificações pós-deploy

| Verificação | Comando / URL | Esperado |
|---|---|---|
| Health check | `GET /api/health` | `{ "status": "ok" }` |
| Login | `POST /api/auth/login` | Token JWT |
| Permissões | Acesso sem permissão | HTTP 403 |
| CORS | Frontend → API | Sem erro de origem |
| SGP sync | Painel Integrações | Sync completa OK |
| Headers | `curl -I https://api...` | Helmet (HSTS, nosniff) |

### Homologação SGP real

```bash
export BOOTSTRAP_ADMIN_EMAIL="admin@suaisp.com.br"
export BOOTSTRAP_ADMIN_PASSWORD="SenhaForte123"
export SGP_API_URL="https://sua-instancia.sgp.net.br"
export SGP_APP="seu-app"
export SGP_TOKEN="seu-token"
export SGP_TIMEOUT_MS="15000"
npm run bootstrap:production
npm run homologate:sgp
```

O relatório é gravado em `homologation-report.json` na raiz do projeto.

### Bootstrap de produção

```bash
export BOOTSTRAP_TENANT_NAME="Minha ISP"
export BOOTSTRAP_TENANT_SLUG="minha-isp"
export BOOTSTRAP_ADMIN_NAME="Administrador"
export BOOTSTRAP_ADMIN_EMAIL="admin@suaisp.com.br"
export BOOTSTRAP_ADMIN_PASSWORD="SenhaForte123"
npm run bootstrap:production
```

## 4. Plano de rollback

1. **Parar** novos deploys (API + Web).
2. **Reverter** para a imagem/commit anterior.
3. **Banco:** migrations são forward-only. Se a migration nova for destrutiva, restaure backup PostgreSQL anterior ao deploy.
4. **Validar** `GET /api/health` e login.
5. **Comunicar** janela de indisponibilidade se necessário.

### Backup recomendado antes do deploy

```bash
pg_dump "$DATABASE_URL" > backup-pre-deploy-$(date +%Y%m%d).sql
```

## 5. Riscos conhecidos pós-deploy

| Risco | Mitigação |
|---|---|
| Rate limit in-memory com múltiplas réplicas | Usar sticky sessions ou migrar throttler para Redis |
| JWT sem refresh/revogação | Rotacionar secret invalida tokens; planejar refresh tokens |
| Páginas mock no frontend (`/flows`, etc.) | Ocultar do menu ou implementar antes do go-live |
| Homologação SGP real pendente | Executar `npm run homologate:sgp` com credenciais reais |

## 6. Comandos úteis

```bash
npm run db:migrate:status      # status das migrations
npm run prisma:validate        # validar schema
npm run prisma:validate:migrations
npm run homologate:sgp         # homologação SGP real
npm run load-test              # teste de carga local
```
