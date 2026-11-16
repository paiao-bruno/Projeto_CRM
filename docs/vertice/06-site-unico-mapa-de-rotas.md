# 06 — Site único: layout, tema e mapa de rotas

## Decisão
Um só shell (`components/app-shell.tsx`), um só tema (`app/theme.css`, variáveis `--vx-*`, marca em
`lib/brand.ts`) e um só grupo de rotas `(app)`. O grupo `(vertice)` foi removido. As telas herdadas do
ISP CRM (classes escuras) foram mantidas, e a paleta Tailwind é invertida no `@theme` para que
renderizem no tema claro sem reescrever cada classe.

## Páginas (todas autenticadas por permissão, sem SGP/NestJS)
| Rota | Fonte de dados | Permissão |
|---|---|---|
| `/dashboard` | `GET /api/dashboard` | dashboard.read |
| `/inbox` | `/api/inbox/*` + SSE `/api/realtime/stream` | chat.read |
| `/chat` | redireciona para `/inbox` (`next.config.ts`) | — |
| `/sales-funnel` | `/api/sales-funnel/*` | sales_funnel.read |
| `/customers` | `/api/customers` | customers.manage |
| `/contracts` | `/api/contracts` | customers.manage |
| `/invoices` | `/api/invoices` (registro local; sem emissão/cobrança) | customers.manage |
| `/ai-agents` | `/api/ai-agents` | ai_agents.manage |
| `/integrations` | `/api/channels` (canais, segredo HMAC, entregas) | crm.manage |
| `/boards` | `/api/boards` (Quadro Ao Vivo; mover ≠ venda) | chat.read |
| `/history` | `/api/team/history` | chat.transfer |
| `/team` | `/api/team/*` (equipe, setores, rodízio) | team.manage |
| `/audit` | `/api/team/audit` | audit.read |
| `/forgot-password`, `/reset-password` | `/api/auth/forgot`, `/api/auth/reset` | público |
| `/flows`, `/campaigns`, `/schedule`, `/team-chat` | páginas herdadas, sem backend novo | flags |

Estados de entrega exibidos na caixa de entrada: PENDING, PROCESSING, ACCEPTED, DELIVERED, FAILED, UNKNOWN.
Capturas: ver `docs/vertice/evidence/` e artefatos da execução (desktop 1366x800 e mobile 390x844).
