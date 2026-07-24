# Arquitetura do CRM SaaS para Provedores de Internet

Este documento descreve a primeira fase do produto: arquitetura, limites de dominio, estrutura de pastas, banco de dados e plano de evolucao antes da criacao das telas e funcionalidades finais.

## Objetivo do produto

Construir um CRM SaaS moderno para ISPs com atendimento omnichannel, agentes de IA, automacoes visuais, CRM comercial, campanhas, agenda e comunicacao interna, mantendo suporte nativo a multiempresa, permissoes por cargo, operacao em tempo real e base tecnica pronta para producao.

## Stack definida

- Frontend: Next.js, TypeScript, TailwindCSS, Shadcn/UI.
- Backend: NestJS, TypeScript, Clean Architecture.
- Banco transacional: PostgreSQL.
- ORM: Prisma.
- Cache, filas leves e presenca: Redis.
- Tempo real: WebSocket via NestJS Gateway e Redis Pub/Sub.
- Infra local/producao: Docker e Docker Compose.
- Busca semantica: PostgreSQL com pgvector inicialmente, com possibilidade de evoluir para motor dedicado.

## Principios arquiteturais

1. **Multitenancy por linha**: todas as entidades operacionais carregam `tenantId`; isolamento e autorizacao sao aplicados no backend.
2. **Clean Architecture no backend**: dominios independentes de frameworks; Prisma, Redis, WebSocket e provedores externos ficam em adapters.
3. **Frontend orientado a features**: telas, hooks, componentes e chamadas de API agrupados por modulo de negocio.
4. **Eventos em tempo real como primeira classe**: mensagens, presenca, metricas e status de integracoes sao publicados em eventos internos e enviados por WebSocket.
5. **Permissoes explicitas**: cargos e permissoes por tenant, com auditoria das acoes sensiveis.
6. **Integracoes isoladas**: WhatsApp, webhooks, LLMs e APIs externas ficam atras de portas de dominio.
7. **Escalabilidade gradual**: PostgreSQL e Redis cobrem a primeira versao; workers e servicos dedicados podem ser extraidos sem mudar os contratos centrais.

## Visao de alto nivel

```text
Usuario
  |
  v
Next.js Web App
  | REST/HTTP                      | WebSocket
  v                                v
NestJS API -------------------- Realtime Gateway
  |                                |
  | Domain/Application Services    | Redis Pub/Sub
  v                                v
Prisma ORM -------------------- Redis
  |
  v
PostgreSQL + pgvector

Workers NestJS
  |-- ingestao de documentos
  |-- campanhas agendadas
  |-- execucao de flows
  |-- sincronizacao de integracoes
  |-- agregacao de metricas
```

## Monorepo proposto

```text
.
|-- apps
|   |-- web
|   |   |-- app
|   |   |   |-- (auth)
|   |   |   |-- (dashboard)
|   |   |   |-- dashboard
|   |   |   |-- chat
|   |   |   |-- team-chat
|   |   |   |-- ai-agents
|   |   |   |-- knowledge-base
|   |   |   |-- flows
|   |   |   |-- integrations
|   |   |   |-- crm
|   |   |   |-- campaigns
|   |   |   `-- schedule
|   |   |-- components
|   |   |   |-- ui
|   |   |   |-- layout
|   |   |   |-- charts
|   |   |   `-- forms
|   |   |-- features
|   |   |   |-- dashboard
|   |   |   |-- conversations
|   |   |   |-- team-chat
|   |   |   |-- ai-agents
|   |   |   |-- knowledge-base
|   |   |   |-- flow-builder
|   |   |   |-- integrations
|   |   |   |-- crm
|   |   |   |-- campaigns
|   |   |   `-- schedule
|   |   |-- lib
|   |   |-- hooks
|   |   |-- styles
|   |   `-- tests
|   `-- api
|       |-- src
|       |   |-- main.ts
|       |   |-- app.module.ts
|       |   |-- config
|       |   |-- common
|       |   |   |-- decorators
|       |   |   |-- filters
|       |   |   |-- guards
|       |   |   |-- interceptors
|       |   |   `-- pipes
|       |   |-- modules
|       |   |   |-- auth
|       |   |   |-- tenants
|       |   |   |-- users
|       |   |   |-- dashboard
|       |   |   |-- conversations
|       |   |   |-- team-chat
|       |   |   |-- ai-agents
|       |   |   |-- knowledge-base
|       |   |   |-- flows
|       |   |   |-- integrations
|       |   |   |-- crm
|       |   |   |-- campaigns
|       |   |   |-- schedule
|       |   |   |-- files
|       |   |   |-- notifications
|       |   |   `-- audit
|       |   |-- infrastructure
|       |   |   |-- prisma
|       |   |   |-- redis
|       |   |   |-- websocket
|       |   |   |-- storage
|       |   |   |-- queues
|       |   |   `-- llm
|       |   `-- workers
|       `-- tests
|-- packages
|   |-- config
|   |-- eslint-config
|   |-- tsconfig
|   |-- shared
|   |   |-- src
|   |   |   |-- contracts
|   |   |   |-- events
|   |   |   |-- permissions
|   |   |   `-- schemas
|   |   `-- tests
|   `-- ui
|       |-- src
|       |   |-- components
|       |   `-- tokens
|       `-- tests
|-- prisma
|   |-- schema.prisma
|   |-- migrations
|   `-- seed.ts
|-- docs
|-- infra
|   |-- nginx
|   |-- postgres
|   `-- redis
|-- docker-compose.yml
|-- .env.example
`-- README.md
```

## Backend: Clean Architecture

Cada modulo do NestJS deve seguir a mesma organizacao:

```text
modules/<domain>
|-- domain
|   |-- entities
|   |-- value-objects
|   |-- events
|   `-- repositories
|-- application
|   |-- commands
|   |-- queries
|   |-- use-cases
|   `-- dto
|-- infrastructure
|   |-- prisma
|   |-- mappers
|   `-- adapters
`-- presentation
    |-- http
    |-- websocket
    `-- consumers
```

### Responsabilidades por camada

- **Domain**: regras puras, invariantes, eventos de dominio e interfaces.
- **Application**: casos de uso, transacoes, validacao de permissoes e publicacao de eventos.
- **Infrastructure**: Prisma, Redis, storage, APIs externas, LLMs e adaptadores de filas.
- **Presentation**: controllers REST, gateways WebSocket, DTOs de entrada e consumidores de eventos.

## Frontend

O frontend sera construido com App Router do Next.js e agrupamento por modulo. Shadcn/UI fornece os componentes base; componentes especificos de negocio ficam em `features`.

### Padroes principais

- Server Components para cascas de pagina e dados de baixa volatilidade.
- Client Components para chat, flow builder, graficos em tempo real e upload.
- React Hook Form e Zod para formularios.
- TanStack Query para cache client-side de chamadas REST.
- WebSocket client dedicado em `lib/realtime`.
- Tailwind tokens centralizados e tema responsivo.

## Dominios e modulos

### 1. Dashboard

Responsavel por indicadores executivos e operacionais:

- Mensagens processadas.
- Conversas ativas.
- Agentes online.
- Taxa de resposta.
- Tempo medio de resposta.
- Satisfacao do cliente.
- Conversoes.
- Graficos em tempo real.

Fontes de dados:

- `Message`, `Conversation`, `TeamPresence`, `AiAgent`, `CampaignRecipient`, `Deal`.
- Agregacoes periodicas em `DashboardMetric`.
- Eventos WebSocket para atualizacao em tempo real.

### 2. Chat

Central de atendimento ao cliente:

- Lista de conversas por status, canal, prioridade e responsavel.
- Historico completo de mensagens.
- Atendimento manual.
- Transferencia entre atendentes e IA.
- Upload de arquivos.
- Registro de handoffs.

Principais entidades: `Conversation`, `Message`, `ConversationHandoff`, `FileAsset`, `Customer`, `AiAgent`.

### 3. Team Chat

Comunicacao interna:

- Salas privadas.
- Grupos.
- Mensagens internas.
- Presenca de usuarios.

Principais entidades: `TeamRoom`, `TeamRoomMember`, `TeamMessage`, `TeamPresence`.

### 4. Agentes de IA

Gestao dos assistentes:

- Cadastro de agentes.
- Prompt do sistema.
- Provedor e modelo: OpenAI, Claude ou Gemini.
- Temperatura e limites.
- Vinculo com bases de conhecimento.
- Ativacao, desativacao e status de treinamento.

Principais entidades: `AiAgent`, `AiAgentKnowledgeBase`, `KnowledgeBase`.

### 5. Base de Conhecimento

Conteudo utilizado por agentes:

- Upload de documentos.
- FAQ.
- Textos manuais.
- Chunks vetorizados.
- Busca semantica com pgvector.

Principais entidades: `KnowledgeBase`, `KnowledgeDocument`, `KnowledgeChunk`, `FaqItem`.

### 6. Flow Builder

Construtor visual de automacoes estilo n8n:

- Nos de trigger, condicao, mensagem, IA, webhook, atraso, atribuicao e fim.
- Versoes publicaveis de fluxos.
- Execucoes rastreaveis.
- Integracao com conversas e agentes de IA.

Principais entidades: `Flow`, `FlowVersion`, `FlowNode`, `FlowEdge`, `FlowExecution`.

### 7. Integracoes

Central de conexoes externas:

- WhatsApp.
- Webhooks.
- APIs externas.
- Status e saude de conexoes.
- Credenciais criptografadas.

Principais entidades: `Integration`, `WebhookEndpoint`, `ApiKey`.

### 8. CRM

Gestao comercial e relacionamento:

- Clientes.
- Contatos.
- Historico de interacoes.
- Leads.
- Pipelines e oportunidades.

Principais entidades: `Customer`, `CustomerContact`, `ContactActivity`, `Lead`, `Pipeline`, `PipelineStage`, `Deal`.

### 9. Campanhas

Marketing e comunicacao em massa:

- Criacao de campanhas.
- Segmentacao.
- Agendamento.
- Metricas de envio, leitura e conversao.

Principais entidades: `Campaign`, `CampaignRecipient`, `CampaignEvent`.

### 10. Agenda

Organizacao operacional:

- Calendario.
- Tarefas.
- Agendamentos automaticos.
- Vinculo com clientes, leads e conversas.

Principais entidades: `ScheduleEvent`, `Task`.

## Multitenancy

- `Tenant` representa cada empresa ISP.
- `User` representa uma identidade global de login.
- `TenantMember` representa o usuario dentro de uma empresa.
- Cargos e permissoes sao vinculados ao tenant.
- Todas as queries operacionais devem receber `tenantId` a partir do contexto autenticado.
- Indices compostos com `tenantId` evitam vazamento e melhoram performance.

## Autenticacao e autorizacao

- Login por email e senha no primeiro ciclo.
- Sessao persistida em tabela `AuthSession`; Redis pode guardar estado de sessoes ativas e revogacao.
- Guardas NestJS:
  - `JwtAuthGuard`.
  - `TenantGuard`.
  - `PermissionsGuard`.
- Permissoes devem ser declaradas em metadata no controller/use case.

Exemplos de permissoes:

- `dashboard.read`
- `chat.read`
- `chat.reply`
- `chat.transfer`
- `team_chat.read`
- `team_chat.write`
- `ai_agents.manage`
- `knowledge_base.manage`
- `flows.manage`
- `integrations.manage`
- `crm.manage`
- `campaigns.manage`
- `schedule.manage`
- `settings.manage`

## Realtime e eventos

Eventos internos devem usar contratos em `packages/shared/src/events`.

Exemplos:

- `conversation.created`
- `conversation.assigned`
- `message.created`
- `message.delivered`
- `handoff.requested`
- `ai_agent.status_changed`
- `integration.health_changed`
- `dashboard.metric_updated`
- `team_presence.updated`
- `campaign.metric_updated`
- `flow.execution_updated`

Fluxo:

1. Caso de uso altera estado transacional no PostgreSQL.
2. Evento de dominio e gravado ou publicado.
3. Publisher envia para Redis Pub/Sub.
4. Gateways WebSocket distribuem por salas de tenant e conversa.
5. Frontend atualiza cache e graficos.

## Redis

Usos iniciais:

- Pub/Sub de eventos WebSocket.
- Presenca online de atendentes.
- Rate limiting.
- Cache de permissoes do membro.
- Locks para campanhas e execucao de flows.
- Filas leves de jobs recorrentes quando aplicavel.

## Armazenamento de arquivos

`FileAsset` registra metadados de arquivos. O storage deve ser pluggable:

- Local em desenvolvimento.
- S3 ou compativel em producao.

Uploads serao usados por:

- Mensagens do chat.
- Base de conhecimento.
- Anexos em CRM.
- Campanhas.

## LLM e IA

Porta de dominio:

```text
LlmProvider
|-- generateReply(context)
|-- embedText(text)
|-- summarizeConversation(conversation)
```

Adaptadores:

- OpenAI.
- Claude.
- Gemini.

O backend decide o provedor pelo `AiAgent.provider` e `AiAgent.model`. Chaves de API devem ser armazenadas criptografadas nas integracoes do tenant ou em cofre externo.

## Observabilidade e seguranca

- Logs estruturados por `tenantId`, `requestId` e `userId`.
- Auditoria em `AuditLog` para alteracoes sensiveis.
- Rate limiting por tenant e usuario.
- Validacao DTO com Zod ou class-validator.
- CORS restrito.
- Segredos fora do repositorio.
- Sanitizacao de HTML/texto enviado por usuarios.
- Webhooks assinados com segredo por endpoint.
- Backups de PostgreSQL e politica de retencao.

## Decisoes iniciais

- PostgreSQL sera a fonte da verdade.
- Prisma sera usado tanto por API quanto workers.
- pgvector cobre a primeira versao de busca semantica.
- Redis sera obrigatorio para realtime escalavel.
- O Flow Builder persistira grafo em JSON por no/aresta, com execucoes normalizadas.
- A primeira versao tera um backend modular unico; extracao para microservicos so deve ocorrer apos limites de escala ficarem claros.
