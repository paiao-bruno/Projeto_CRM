# ISP CRM SaaS

CRM SaaS moderno para provedores de internet (ISP), inspirado no sistema de referencia enviado, com foco em atendimento omnichannel, agentes de IA, CRM comercial, campanhas, agenda, automacoes e operacao em tempo real.

## Primeira fase entregue

Esta fase ainda nao cria telas ou funcionalidades finais. Ela estabelece a base tecnica solicitada:

- Arquitetura completa do sistema em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
- Estrutura de pastas proposta para monorepo Next.js + NestJS.
- Plano de desenvolvimento em [`docs/DEVELOPMENT_PLAN.md`](docs/DEVELOPMENT_PLAN.md).
- Schema Prisma multitenant em [`prisma/schema.prisma`](prisma/schema.prisma).
- Infra local inicial com PostgreSQL + pgvector e Redis em [`docker-compose.yml`](docker-compose.yml).
- Variaveis de ambiente de referencia em [`.env.example`](.env.example).

## Modulos planejados

1. Dashboard em tempo real.
2. Chat de atendimento com historico, transferencia humano/IA e anexos.
3. Team Chat para comunicacao interna.
4. Agentes de IA com prompts, provedores e modelos.
5. Base de conhecimento com documentos, FAQ e busca semantica.
6. Flow Builder visual estilo n8n.
7. Integracoes com WhatsApp, webhooks e APIs externas.
8. CRM de clientes, leads, contatos e pipeline.
9. Campanhas com agendamento, metricas e conversoes.
10. Agenda com calendario, tarefas e agendamentos automaticos.

## Stack

- Next.js + TypeScript.
- TailwindCSS + Shadcn/UI.
- NestJS.
- PostgreSQL + Prisma.
- Redis.
- WebSocket.
- Docker.

## Infra local inicial

Copie o arquivo de ambiente e suba os servicos de dados:

```bash
cp .env.example .env
docker compose up -d postgres redis
```

Quando o monorepo de aplicacao for criado, a API NestJS usara `DATABASE_URL` e `REDIS_URL` desse ambiente.
