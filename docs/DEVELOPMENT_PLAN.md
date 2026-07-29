# Plano de Desenvolvimento

Este plano organiza a construcao do CRM SaaS em marcos tecnicos. A ordem prioriza fundacao, isolamento multiempresa, dados consistentes e contratos reutilizaveis antes de telas finais.

## Marco 1: Fundacao do monorepo

Objetivos:

- Criar workspace com Next.js, NestJS, TypeScript e pacotes compartilhados.
- Configurar TailwindCSS e Shadcn/UI no app web.
- Configurar Prisma, PostgreSQL, Redis e Docker Compose.
- Criar pipeline local de lint, typecheck, test e migrations.

Entregaveis:

- `apps/web` com layout base autenticado.
- `apps/api` com health check e configuracao global.
- `packages/shared` com permissoes, contratos de eventos e schemas.
- `prisma/schema.prisma` aplicado em migration inicial.
- Ambiente local via Docker.

Riscos tecnicos:

- Garantir compatibilidade entre versoes de Next.js, NestJS, Prisma e TypeScript.
- Definir convencoes de importacao e paths compartilhados desde o inicio.

## Marco 2: Autenticacao, tenants e permissoes

Objetivos:

- Implementar login, sessoes e recuperacao basica de acesso.
- Criar estrutura de tenants, membros, cargos e permissoes.
- Aplicar `TenantGuard` e `PermissionsGuard`.
- Criar auditoria para acoes sensiveis.

Entregaveis:

- CRUD administrativo de tenants/membros/cargos.
- Seed de permissoes padrao.
- Middleware de contexto de tenant.
- Testes de isolamento multiempresa.

Riscos tecnicos:

- Vazamento de dados entre tenants se repositories nao exigirem `tenantId`.
- Complexidade de usuarios globais com participacao em multiplas empresas.

## Marco 3: Chat, arquivos e tempo real

Objetivos:

- Implementar conversas, mensagens, anexos e historico completo.
- Criar gateway WebSocket com salas por tenant e conversa.
- Adicionar presenca de agentes com Redis.
- Implementar transferencia manual entre atendentes.

Entregaveis:

- APIs de conversas e mensagens.
- Upload de arquivos.
- Eventos `message.created`, `conversation.assigned` e `handoff.requested`.
- UI inicial da central de atendimento.

Riscos tecnicos:

- Ordenacao e idempotencia de mensagens vindas de integracoes externas.
- Backpressure em conversas muito ativas.

## Marco 4: Integracoes

Objetivos:

- Criar central de integracoes.
- Implementar WhatsApp como primeiro canal.
- Criar webhooks recebidos e enviados.
- Monitorar status de conexoes.

Entregaveis:

- Modelo de credenciais criptografadas.
- Adaptador WhatsApp.
- Assinatura de webhooks.
- Eventos de saude de integracao.

Riscos tecnicos:

- Diferencas entre provedores WhatsApp.
- Garantia de reprocessamento seguro de mensagens externas.

## Marco 5: Agentes de IA e Base de Conhecimento

Objetivos:

- Gerenciar agentes com prompts, provedores e modelos.
- Implementar upload, processamento e chunking de documentos.
- Criar embeddings e busca semantica.
- Permitir transferencia entre humano e IA.

Entregaveis:

- CRUD de agentes.
- CRUD de bases e FAQs.
- Worker de ingestao de documentos.
- Porta `LlmProvider` com adaptadores OpenAI, Claude e Gemini.

Riscos tecnicos:

- Custo e latencia de LLM.
- Qualidade dos chunks e recuperacao semantica.
- Protecao contra prompt injection em documentos carregados.

## Marco 6: Flow Builder

Objetivos:

- Criar estrutura de grafo versionado.
- Implementar nos de trigger, condicao, mensagem, IA, webhook, atribuicao, delay e fim.
- Executar flows em conversas reais.
- Registrar execucoes e passos.

Entregaveis:

- APIs de criacao e publicacao de flows.
- Executor com validacao de grafo.
- UI visual estilo n8n.
- Modal de saida com alteracoes pendentes, inspirado na referencia.

Riscos tecnicos:

- Evitar loops infinitos e estados invalidos.
- Versionar flows sem quebrar execucoes em andamento.

## Marco 7: CRM comercial

Objetivos:

- Criar clientes, contatos, leads, atividades e pipeline.
- Vincular conversas ao historico do cliente.
- Registrar oportunidades e conversoes.

Entregaveis:

- CRUD de clientes e leads.
- Pipeline Kanban.
- Historico consolidado.
- Eventos de conversao usados no dashboard.

Riscos tecnicos:

- Duplicidade de clientes vindos de canais externos.
- Normalizacao de dados de contato.

## Marco 8: Campanhas e agenda

Objetivos:

- Criar campanhas com segmentacao e agendamento.
- Medir disparos, leituras, falhas e conversoes.
- Criar calendario, tarefas e agendamentos automaticos.

Entregaveis:

- Worker de campanhas.
- Metricas por campanha e destinatario.
- Calendario operacional.
- Tarefas vinculadas a clientes, leads e conversas.

Riscos tecnicos:

- Controle de taxa de envio.
- Regras anti-spam e opt-out.
- Concorrencia em campanhas grandes.

## Marco 9: Dashboard executivo e observabilidade

Objetivos:

- Consolidar metricas dos modulos.
- Exibir graficos em tempo real.
- Monitorar agentes, integracoes e operacao.
- Adicionar logs estruturados e rastreamento de erros.

Entregaveis:

- Agregador de metricas.
- Cards e graficos do dashboard.
- Alertas de integracoes degradadas.
- Trilha de auditoria consultavel.

Riscos tecnicos:

- Consultas analiticas impactarem operacao transacional.
- Necessidade de pre-agregacao por volume.

## Marco 10: Endurecimento para producao

Objetivos:

- Revisar seguranca.
- Cobrir fluxos criticos com testes automatizados.
- Preparar deploy.
- Documentar operacao.

Entregaveis:

- Testes unitarios, integracao e e2e dos fluxos centrais.
- Politica de backup e restore.
- Health checks e readiness checks.
- Guias de deploy e runbook.

Riscos tecnicos:

- Credenciais de integracoes externas.
- Migracoes de dados em tenants ativos.
- Observabilidade insuficiente em incidentes.

## Prioridade de implementacao dos modulos

1. Fundacao, tenants e permissoes.
2. Chat e realtime.
3. Integracoes de canais.
4. IA e conhecimento.
5. CRM e dashboard.
6. Flow Builder.
7. Campanhas e agenda.
8. Endurecimento e otimizacoes.

## Criterios de pronto da primeira versao funcional

- Cada request autenticada possui contexto de tenant validado.
- Nenhum repository operacional consulta dados sem `tenantId`.
- Conversas recebem e enviam mensagens em tempo real.
- Um agente de IA pode responder usando uma base de conhecimento.
- Um fluxo publicado pode automatizar uma conversa.
- Dashboard reflete metricas reais de mensagens, conversas e conversoes.
- Auditoria cobre alteracoes de permissoes, integracoes, agentes e campanhas.
- Docker sobe PostgreSQL, Redis, API e Web localmente.
