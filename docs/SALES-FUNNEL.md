# Funil de Vendas (Kanban)

Este documento descreve o funil manual multiusuário, a persistência, a desativação segura da sincronização SGP e como reativar componentes legados.

## Escopo entregue

- Página **Funil de Vendas** em `/sales-funnel`
- Persistência em PostgreSQL via Prisma (`Deal`, `DealHistory`, `PipelineStage.code`)
- Indicadores derivados dos dados reais do funil
- CRM, Contratos e Faturas preservados
- Integração SGP/API legada preservada, porém inativa por padrão

## Modos de execução

| Modo | Comando | API NestJS (4000) | SGP auto-sync | Uso |
|------|---------|-------------------|---------------|-----|
| **Web-only (recomendado agora)** | `npm run dev:web:funnel` | Desligada | Desligada | Testar Funil sem `apps/api` |
| API + Web (SGP off) | `npm run dev:funnel` | Ligada | Desligada | Stack completa legada |
| Stack completa | `npm run dev` | Ligada | Conforme `.env` | Desenvolvimento integral |

No modo **web-only**, o Next.js expõe `/api` via Route Handlers em `apps/web/src/app/api/` com Prisma direto no PostgreSQL. Não há mock nem localStorage.

## Inicialização no Windows (PowerShell)

### Caminho correto do repositório

Os comandos `npm` devem ser executados na **raiz** do clone — a pasta que contém **simultaneamente**:

- `package.json` (raiz)
- `apps\web\package.json`
- `apps\api\package.json`

Exemplo confirmado no ambiente do usuário:

```powershell
C:\Users\User\Desktop\CRM\Projeto_CRM\Projeto_CRM-cursor-isp-crm-architecture-edc0
```

**Não** execute em `C:\WINDOWS\System32` nem dentro de `apps\web\.next\`.

### Pré-requisitos

1. Node.js **20+** (`node -v`)
2. npm (vem com Node; lockfile: `package-lock.json` → use **npm**, não yarn/pnpm)
3. Docker Desktop (para PostgreSQL via `docker compose up -d postgres`)
4. Branch com o script `dev:web:funnel`: `cursor/homologation-fixes-edc0`

### Sequência validada (Terminal 1)

```powershell
Set-Location -LiteralPath "C:\Users\User\Desktop\CRM\Projeto_CRM\Projeto_CRM-cursor-isp-crm-architecture-edc0"

git fetch origin
git checkout cursor/homologation-fixes-edc0
git pull

npm install
npm run preflight
npm run dev:web:funnel
```

### Atalho PowerShell (Terminal 1)

```powershell
Set-Location -LiteralPath "C:\Users\User\Desktop\CRM\Projeto_CRM\Projeto_CRM-cursor-isp-crm-architecture-edc0"
npm run dev:web:funnel:ps1
```

Saída esperada:

```text
[preflight] Ambiente OK para dev:web:funnel.
[dev:web:funnel] Iniciando somente apps/web (sem apps/api)...
[dev:web:funnel] Funil: http://localhost:3000/sales-funnel
✓ Ready in ...
```

Abrir no navegador: `http://localhost:3000/sales-funnel`

### Erros comuns

| Erro | Causa | Correção |
|------|-------|----------|
| `ENOENT package.json` em `System32` | Diretório errado | `Set-Location` para a raiz do clone |
| `EPERM` em `System32` | npm na pasta do Windows | Mesmo: ir para a raiz do projeto |
| `Script dev:web:funnel ausente` | Branch antiga | `git checkout cursor/homologation-fixes-edc0` + `git pull` |
| `PostgreSQL is not ready` | Banco parado | `docker compose up -d postgres` |
| Prefixo `[api]` no terminal | Usou `dev` ou `dev:funnel` | Use `dev:web:funnel` |
| `EADDRINUSE :::3000` | Porta ocupada | Ver seção abaixo |

### Liberar porta 3000 (somente se necessário)

```powershell
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue |
  Select-Object -Property OwningProcess -Unique |
  ForEach-Object {
    $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
    if ($p.ProcessName -match "node") {
      Stop-Process -Id $_.OwningProcess -Force
    }
  }
```

## Desativação da sincronização SGP

O que permanece desligado por padrão no modo web-only:

- `SGP_AUTO_SYNC_ENABLED=false` (definido pelo script)
- Processo NestJS (`apps/api/dist/main.js`) **não inicia**
- Porta **4000** permanece livre

O código em `apps/api`, módulos SGP, scripts de homologação e migrations **não foram removidos**.

## Como reativar a API/SGP no futuro

```powershell
Set-Location -LiteralPath "C:\Users\User\Desktop\CRM\Projeto_CRM\Projeto_CRM-cursor-isp-crm-architecture-edc0"

# 1) Opcional: habilitar auto-sync no .env
# SGP_AUTO_SYNC_ENABLED=true

# 2) Subir stack completa
npm run dev:funnel
```

## Permissões

- `sales_funnel.read`: visualizar quadro, detalhes e indicadores
- `sales_funnel.manage`: criar, editar, mover, arquivar, restaurar e marcar como perdida

## Etapas centralizadas

Definidas em `shared/sales-funnel.constants.ts`:

1. Prospecção
2. Viabilidade
3. Negociação
4. Contrato
5. Agendamento
6. Ativação

**Perdido** não é coluna do quadro; é encerramento com motivo obrigatório.

## Páginas legadas no modo web-only

CRM, Contratos e Faturas permanecem no menu. Enquanto a API NestJS estiver desligada, exibem mensagem informativa — sem loop de requisições nem sync SGP.

## Endpoints (modo web-only via `/api`)

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/auth/login` | Login |
| GET | `/auth/me` | Perfil |
| GET | `/sales-funnel/board` | Quadro Kanban |
| GET | `/sales-funnel/metrics` | Indicadores |
| POST | `/sales-funnel/deals` | Criar oportunidade |
| PATCH | `/sales-funnel/deals/:id` | Editar |
| POST | `/sales-funnel/deals/:id/move` | Mover/reordenar |

## Riscos restantes

- Tenants existentes podem precisar de concessão manual das permissões `sales_funnel.*`
- Concorrência via campo `version`; conflitos exigem recarregar o quadro
- Clone em branch antiga sem `dev:web:funnel` exige `git pull` na branch correta
