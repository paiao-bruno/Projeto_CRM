# 12 — Matriz viva da evolução (RF01–RF39)

Fonte primária: o briefing "PROMPT MESTRE — EVOLUÇÃO DO VÉRTICE A PARTIR DA REFERÊNCIA VISUAL".
**Limitação registrada:** os 9 prints e os 5 vídeos não estão acessíveis no ambiente (busca em disco: o único
`.mp4` encontrado é um arquivo de infraestrutura de 1,5 s, não é material de referência). Nada foi "assistido":
o inventário do briefing é a fonte secundária. Coluna **Referência** = o que o briefing afirma ter sido visto.

## Baseline confirmada em 2026-10-29 (não herdada de relatórios)
- Linux 6.12, Node v22.23.4, npm 10.9.9; branch `cursor/vertice-foundation-edc0` @ `fb2033c`, árvore limpa.
- PostgreSQL 16 (embutido, porta 54329) ativo; Redis: não usado (PostgreSQL-first; compose `--profile legacy`).
- NestJS (`apps/api`) opt-in; nenhum SGP no fluxo padrão (prova: `npm run test:site-e2e`, ver doc 09).
- 6 migrations + `20261029100000`/`20261029110000`; 57 modelos Prisma, a maioria herdada do legado sem serviço no Next.
- Rotas Next existentes: auth, health, customers/contracts/invoices, ai-agents, dashboard, channels, inbox, sales-funnel,
  realtime/stream, webhooks/inbound. Páginas `campaigns`, `flows`, `schedule`, `team-chat` existem, ficam atrás de
  `NEXT_PUBLIC_ENABLE_*=false` e chamam rotas que **não existem** no Next (legado NestJS) → classificadas "legado desligado".

## Achados da auditoria (causas, não correções presumidas)
| # | Achado | Evidência |
|---|---|---|
| F1 | Presença do cabeçalho é estado local (`useState("ONLINE")`): todo reload volta a ONLINE e envia heartbeat; o resumo da equipe lê `TeamPresence` com expiração de 90 s. É a causa provável da divergência cabeçalho × resumo. | `components/app-shell.tsx`, `server/inbox/rules.ts#derivePresence` |
| F2 | JWT de 8 h com permissões embutidas; `AuthSession` existe no schema mas o login do Next não a usa; logout é só do lado do cliente (token continua válido); usuário desativado segue autenticado até expirar. | `server/auth.ts` |
| F3 | Login ainda com marca "ISP CRM SaaS" (A01). | `app/login/page.tsx` |
| F4 | Inbox sem setor, tag, canal/operador como filtro, nova conversa, atribuição pelo supervisor (só transferir), motivo de encerramento padronizado. | `server/inbox/service.ts` |
| F5 | Não há CRUD de usuários/papéis/setores no Next. | rotas |
| F6 | `sgp-clientes-sample-mascarar.json` e `sgp-e2e-evidence.json` estão versionados na raiz (possíveis dados pessoais). Não alterados; pendência de revisão pelo usuário. | `git ls-files` |
| F7 | Dashboard: enums técnicos em inglês e sem data de origem — diagnóstico em RF02. | `server/dashboard.ts` |

## Matriz
Legenda Projeto: **V** confirmado/validado em execução · **C** confirmado no código · **P** parcial · **A** ausente (confirmado por inspeção) · **L** legado desligado.
Estado final de cada RF na seção "Resultado" do fim deste arquivo (atualizado ao final de cada etapa).

| ID | Referência (briefing) | Projeto hoje | Lacuna → implementação (proposta) | Teste | 
|---|---|---|---|---|
| RF01 | Login/identidade; 2FA "visto" | P (login real; marca antiga; sem sessão revogável; sem recuperação) | Sessão em `AuthSession` (sid no JWT), logout que revoga, recuperação por token de uso único, presença canônica | integração (sessão, expiração, reset) |
| RF02 | Dashboard e filtros por período | P (contadores) | Filtros período/canal/setor/operador, séries, fórmulas documentadas, detalhamento | integração de métricas |
| RF03 | Atendimento, fila, aceitar | P (claim/transfer/close/reopen/notas) | Setor, filtros, nova conversa, atribuir, motivos | integração |
| RF04 | Quadro Ao Vivo | A | Quadros manuais independentes de CRM | integração (mover ≠ venda/tag) |
| RF05 | Pesquisa avançada | A | Histórico filtrável + CSV | integração |
| RF06 | Gestão em lote | A | Prévia, execução por item, auditoria | integração |
| RF07 | Rodízio | A | Regras, participantes, algoritmo determinístico | integração (concorrência) |
| RF08 | Contatos enriquecidos, import/export | P (Customer básico) | Campos, import com erros por linha | integração |
| RF09 | Duplicados | A | Detecção + mescla transacional | integração |
| RF10–RF12 | Tarefas, agenda, kanbans | L/A | Etapa E2 | — |
| RF13–RF20 | Comercial | P (funil) | Etapa E3 | — |
| RF21–RF25 | Tags, respostas rápidas, mídia, chat interno, avaliações | L/A | Etapa E2 | — |
| RF26 | Canais/templates | P (adaptador de teste) | Adaptador real = dependência externa | — |
| RF27 | Setores/chatbot | A | Setores (CRUD, expediente, fallback) agora; chatbot em E4 | integração |
| RF28 | Categorias | A | Categoria de setor com setores | integração |
| RF29 | Equipe | P (lista de membros p/ transferência) | CRUD de equipe, desativar com política | integração |
| RF30 | Auditoria | P (`AuditLog` grava; sem tela) | Tela/API filtrável + CSV sanitizado | integração |
| RF31–RF38 | IA exec., fluxos, webhooks, arquivos, config, integrações, avisos, backup | P/A/L | Etapas E4–E5 | — |
| RF39 | Clientes/Contratos/Faturas | V (E2E) | Preservar; paginação/limites | regressão |

Plano desta sessão: E1 em fatias verticais na ordem de dependência real (sessão/presença → setores/equipe/tags →
inbox completo → rodízio → quadros/histórico/lote → dashboard → auditoria). E2–E5 seguem como próximas ações.
