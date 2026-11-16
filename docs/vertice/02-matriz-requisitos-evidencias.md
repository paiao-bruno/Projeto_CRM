# 02 — Matriz de módulos, estado real e evidência

Legenda: **VE** validado por execução · **VS** validado estaticamente · **PEN** pendente · **BLO** bloqueado pelo ambiente · **FAL** falhou.
Origem V/M/P/D: a gravação de referência não estava disponível; a coluna "Origem" usa apenas a lista de módulos do prompt
(tratada como **P**, proposto) e **não** afirma o que foi visto ou mencionado na gravação.

Nenhum módulo está "concluído". Os parciais abaixo declaram exatamente o que foi e o que não foi validado.

| Módulo | Estado | Validado (evidência) | Pendente / observações |
|---|---|---|---|
| M01 Acesso e presença | **Parcial** | VE: heartbeat e status Online/Ausente/Offline, expiração de 90 s (unidade `rules.test.ts`, integração "presença", E2E, UI). Login/JWT/permissões preexistentes exercitados no E2E | Sessões revogáveis, auditoria de login, bloqueio por tentativas |
| M02 Indicadores | **Parcial mínimo** | VE: contadores por aba (fila/meus/todos/encerradas) | Painel de indicadores, SLA, tempos |
| M03 Caixa de entrada | **Parcial** | VE: ingestão idempotente (replay + 10 simultâneas), assumir com 1 vencedor em 8, transferir, encerrar/reabrir, responder idempotente (registro), não lidas, busca, abas, isolamento por organização (19 testes de integração, E2E HTTP, UI com Chrome) | Canais reais, mídia, WebSocket (hoje polling 5 s), outbox/envio, buffers por cliente, templates, lease+fencing de workers |
| M04 Histórico | **Parcial** | VE: linha do tempo (`ConversationEvent`) por conversa | Busca global, filtros, exportação |
| M05 Rodízios | PEN | Presença já disponível como insumo | Regras, filas, round-robin |
| M06 Contatos | **Parcial mínimo** | VE: criação/associação por telefone sob lock (sem duplicar em paralelo) | Duplicidades/mesclagem, importação, campos |
| M07 Tarefas | PEN | Modelo `Task` já no schema | Tudo |
| M08 Calendário | PEN | Modelo `ScheduleEvent` já no schema | Tudo |
| M09 Kanban | Preexistente | VS: `test:sales-funnel-contract`; Funil legado não alterado | `test:sales-funnel-integration` não executa (script com sintaxe TS; ver baseline) |
| M10 Produtos/cadastros | PEN | — | Tudo |
| M11 Oportunidades | Preexistente | Funil de Vendas (`Deal`) legado, não alterado | Ligação conversa → oportunidade |
| M12 Propostas | PEN | — | Tudo |
| M13 Desempenho comercial | PEN | — | Tudo |
| M14 Tags/remarketing | PEN | — | Tudo |
| M15 Respostas rápidas/mídia | PEN | — | Tudo |
| M16 Comunicação interna | PEN | Modelos `TeamRoom/TeamMessage` no schema; UI legada atrás de flag | Integrar |
| M17 Qualidade/avaliações | PEN | — | Tudo |
| M18 Conexões/canais/templates | PEN | `Integration` (SGP) preexistente | Conector de canal, webhook assinado de entrada |
| M19 Setores/equipe/expediente | **Parcial mínimo** | VE: listagem de membros aptos (`chat.reply`) com presença | Setores, expediente |
| M20 IA/conhecimento | PEN | Modelos legados no schema | Tudo |
| M21 Automação visual/webhooks | PEN | Modelos `Flow*` no schema | Tudo |
| M22 Sistema/auditoria/backup | PEN | `scripts/backup-database.ps1` preexistente (não executado aqui) | Auditoria transversal, restauração testada |

## Etapas do prompt

| Etapa | Estado |
|---|---|
| 0 Inspeção, baseline, plano, matriz | Feita (esta pasta) |
| 1 Fundação (marca/tema, acesso, presença) | Parcial: tema centralizado + shell + presença; sessões/auditoria pendentes |
| 2 Contatos | Parcial mínimo |
| 3 Núcleo de atendimento | Parcial (ver M03) |
| 4–8 | Não iniciadas |

## Evidências executadas nesta sessão

| Comando | Resultado |
|---|---|
| `npm run typecheck` | OK (web e api) |
| `npm test -w apps/web` | 38/38 |
| `npm test -w apps/api` | 137/137 |
| `npm run test:inbox-integration` | 19/19 (PostgreSQL real descartável) |
| `npm run test:inbox-e2e` | OK (Next dev real, HTTP) |
| `npm run build -w apps/web` | OK (rota `/inbox` e `/api/inbox/[...path]` presentes) |
| `test:disposable-db`, `test:restored-pages`, `test:bootstrap-permissions`, `test:jwt-secret`, `test:sales-funnel-contract` | OK |
| `prisma migrate diff` (migrations aplicadas × schema) | Sem divergência além de `vector` (artefato do ambiente sem pgvector) |
| UI no Chrome headless (login → simular → assumir → responder) | OK; capturas em `/opt/cursor/artifacts/screenshots/` |
| `test:sales-funnel-integration`, `prisma:validate:migrations` | **Não executáveis** neste ambiente (preexistentes) |

Não validado: Windows/PowerShell nesta entrega, pgvector, Redis, qualquer canal real, carga.
