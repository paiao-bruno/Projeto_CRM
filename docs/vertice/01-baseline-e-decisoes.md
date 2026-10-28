# 01 — Baseline, decisões e conflitos

## Baseline confirmada (28/10/2026)

- Monorepo npm workspaces: `apps/api` (NestJS 11, Prisma 7), `apps/web` (Next.js 15, Tailwind 4),
  PostgreSQL (pgvector) e Redis via `docker-compose.yml`. Schema com ~51 modelos
  (Conversation, Message, ConversationHandoff, TeamRoom, TeamPresence, Flow, KnowledgeBase, Deal,
  Pipeline, Task, ScheduleEvent...).
- Há **duas linhas divergentes** no GitHub:
  - `cursor/isp-crm-architecture-edc0`: 5 commits à frente (rotina de re-criptografia SGP);
    **não tem** o Funil de Vendas nem o modo web-only.
  - `cursor/homologation-fixes-edc0` (`f970dcc`): 21 commits à frente (Funil Kanban, modo web-only,
    bootstrap, interfaces restauradas). É a linha que o usuário executa no Windows.
- Esta entrega parte de `f970dcc` (branch `cursor/vertice-foundation-edc0`) para não perder o Funil.
  A reconciliação das duas linhas (merge dos 5 commits SGP) **não foi feita**.
- Ambiente desta sessão: Linux, Node 22, sem Docker/PostgreSQL/Redis do sistema. Para testar de verdade
  foi usado um PostgreSQL embutido (`embedded-postgres`, instalado fora do repositório em `/tmp`),
  sem a extensão `vector`.

## Decisões

| # | Decisão | Motivo | Reversão |
|---|---|---|---|
| D1 | Manter Next.js + NestJS + Prisma + Redis; não criar serviço novo | Regra "preserve arquitetura" | — |
| D2 | Novos módulos como Route Handlers do Next (`/api/inbox/*`) + serviço em `apps/web/src/server/inbox`, como o Funil | É o modo que o usuário consegue executar hoje (API NestJS desligada) | Mover o serviço para um módulo Nest |
| D3 | Migration **somente aditiva** (colunas com default, 3 tabelas novas) | Sem migration destrutiva | Remover colunas/tabelas novas |
| D4 | Reaproveitar `Conversation`, `Message`, `ConversationHandoff`, `Customer`, `TeamPresence` | Evitar modelo paralelo | — |
| D5 | Tema Vértice isolado no grupo de rotas `(vertice)`; telas legadas (escuras) intactas | Regra anterior de não alterar Funil/menu; troca global seria mudança ampla e visível | Aplicar o tema ao `(app)` |
| D6 | Concorrência por compare-and-set em `Conversation.version` + advisory lock por (org, telefone) + `ON CONFLICT DO NOTHING` em `InboundEvent` | Invariantes do prompt (dedupe, uma só vitória) | — |
| D7 | Resposta do atendente é apenas **registrada** (`RECORDED_ONLY`); nenhum envio externo | Sem canal conectado; proibido enviar mensagens reais | Implementar outbox + adaptador |
| D8 | Simulador de entrada (`/api/inbox/demo-inbound`) só com `chat.transfer`, desligado em produção (`VERTICE_DEMO_INBOUND`) | Permitir demonstração sem canal real, sem "sucesso fictício" | Remover a rota |
| D9 | A tela `/inbox` exige modo web-only e mostra aviso caso contrário | Token e rotas diferem do modo NestJS | Portar para a API Nest |

## Conflitos de regras e como foram tratados

1. **"Não faça commit/push sem autorização" (prompt) × "commit e push obrigatórios" (ambiente cloud).**
   Foi feito commit/push **somente** em branch nova `cursor/vertice-foundation-edc0`; nenhuma branch existente
   foi alterada, nada foi mesclado em `main`. Se não desejar, descarte a branch.
2. **Gravação "Acelerator_exemplo(1).mp4" não está disponível neste ambiente.** A matriz usa apenas a lista de
   módulos do prompt; as classificações V/M/P/D por funcionalidade da gravação **não** foram feitas.
3. **Documentação oficial de versões** não foi reconsultada: nenhuma dependência nova foi adicionada ao repositório.

## Riscos abertos

- Tempo real por polling (5 s), não WebSocket.
- `test:sales-funnel-integration` e `prisma:validate:migrations` (preexistentes) não rodam neste ambiente
  (`.mjs` com sintaxe TypeScript `!` na linha 135 do primeiro; segundo exige PostgreSQL em `localhost:5432`).
- Duas linhas Git divergentes precisam de reconciliação (decisão do usuário).
- Sessões de login continuam JWT sem revogação; `AuthSession` existe no schema mas não é usada no modo web-only.
