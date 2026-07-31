# Funil de Vendas (Kanban)

Este documento descreve o funil manual multiusuário, a persistência, a desativação segura da sincronização SGP e como reativar componentes legados.

## Escopo entregue

- Página **Funil de Vendas** em `/sales-funnel`
- API REST em `/api/sales-funnel/*`
- Persistência em PostgreSQL via Prisma (`Deal`, `DealHistory`, `PipelineStage.code`)
- Indicadores derivados dos dados reais do funil
- CRM, Contratos e Faturas preservados
- Integração SGP/API legada preservada, porém inativa por padrão

## Desativação da sincronização SGP

A API **continua necessária** para autenticação JWT, autorização e persistência compartilhada do funil.

O que foi desligado por padrão:

- `SGP_AUTO_SYNC_ENABLED=false` em `.env.example`
- script `npm run dev:funnel`, que inicia API + Web com auto-sync desabilitado

O código em `apps/api`, módulos SGP, scripts de homologação e migrations **não foram removidos**.

### Como iniciar somente o necessário (PowerShell)

```powershell
# Diretório: raiz do repositório
cd C:\Users\User\Desktop\CRM\Projeto_CRM_Git

# Objetivo: subir API + Web com SGP auto-sync desligado
# Saída esperada: API em http://localhost:4000 e Web em http://localhost:3000
npm run dev:funnel

# Se falhar por banco:
# 1) confirme PostgreSQL ativo
# 2) revise DATABASE_URL no .env
# 3) execute apenas migrate deploy, nunca reset em banco real
npm run db:migrate:deploy

# Se a API falhar com "Cannot find module ... dist\main":
npm run build -w apps/api

# Se a Web falhar com "EADDRINUSE :::3000" (porta ocupada):
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

### Como reativar a API/SGP no futuro

```powershell
# Diretório: raiz do repositório
cd C:\Users\User\Desktop\CRM\Projeto_CRM_Git

# 1) Habilitar auto-sync SGP no .env
# SGP_AUTO_SYNC_ENABLED=true

# 2) Subir stack completa
npm run dev

# 3) Homologação/manual sync permanecem disponíveis
npm run homologate:sgp
```

## Permissões

- `sales_funnel.read`: visualizar quadro, detalhes e indicadores
- `sales_funnel.manage`: criar, editar, mover, arquivar, restaurar e marcar como perdida

Tenants novos via bootstrap recebem as permissões automaticamente. Tenants existentes precisam receber as permissões no papel administrativo (via bootstrap idempotente ou seed demo).

## Etapas centralizadas

Definidas em `shared/sales-funnel.constants.ts`:

1. Prospecção
2. Viabilidade
3. Negociação
4. Contrato
5. Agendamento
6. Ativação

**Perdido** não é coluna do quadro; é encerramento com motivo obrigatório.

## Fórmulas de conversão

- **Conversão geral** = oportunidades que chegaram à Ativação ÷ oportunidades criadas no período
- **Taxa entre etapas** = oportunidades na etapa seguinte ÷ oportunidades na etapa anterior

Quando o denominador é zero, a interface exibe `—`.

## Migration aditiva

Arquivo: `prisma/migrations/20260731120000_sales_funnel_kanban/migration.sql`

Impacto:

- adiciona colunas em `Deal`
- adiciona `PipelineStage.code`
- cria `DealHistory`
- não remove tabelas/dados existentes

Rollback manual: reverter migration em ambiente controlado; não executar em produção sem plano.

## Dependência das páginas legadas

CRM, Contratos e Faturas continuam chamando a API via `apps/web/src/lib/api.ts`. Elas permanecem acessíveis enquanto a API estiver em execução — inclusive com `dev:funnel`.

## Endpoints principais

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/sales-funnel/board` | Quadro Kanban |
| GET | `/sales-funnel/metrics` | Indicadores |
| POST | `/sales-funnel/deals` | Criar oportunidade |
| PATCH | `/sales-funnel/deals/:id` | Editar |
| POST | `/sales-funnel/deals/:id/move` | Mover/reordenar |
| POST | `/sales-funnel/deals/:id/mark-lost` | Marcar perdida |
| POST | `/sales-funnel/deals/:id/archive` | Arquivar |
| POST | `/sales-funnel/deals/:id/restore` | Restaurar |

## Riscos restantes

- Tenants existentes podem precisar de concessão manual das permissões `sales_funnel.*`
- Métricas de conversão entre etapas usam contagem atual por coluna; evolução histórica fina depende de `DealHistory`
- Concorrência é tratada via campo `version`; conflitos exigem recarregar o quadro

## Próximo passo recomendado

1. Executar migration em banco de homologação
2. Conceder permissões ao papel administrativo dos tenants existentes
3. Validar fluxo multiusuário com dois logins reais
4. Reativar SGP apenas quando a sincronização voltar a ser prioridade
