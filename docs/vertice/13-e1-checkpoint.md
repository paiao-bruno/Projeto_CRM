# 13 — Checkpoint E1 (evolução a partir da referência)

Limitação: os 9 prints e 5 vídeos do briefing **não estavam acessíveis** neste ambiente. O inventário do
prompt foi a fonte secundária. Nada foi “assistido”.

## O que está implementado e validado nesta etapa
| RF | Estado | Teste |
|---|---|---|
| RF01 identidade, sessão revogável, recuperação, presença canônica, login Vértice | implementado e validado | `test:e1-integration`, `brand.test` |
| RF02 dashboard com período, 1ª resposta (null ≠ zero), aniversários só com `metadata.birthDate` | parcial (sem séries por dia/canal completas) | records + typecheck |
| RF03 inbox: filtros, start, assign, motivo de encerramento | implementado e validado (sem áudio/anexo de provedor) | e1 + inbox 19/19 |
| RF04 Quadro Ao Vivo | implementado e validado: mover ≠ venda/setor | e1 |
| RF05 histórico + CSV (até 500 linhas) | implementado (UI + API) | inspeção + typecheck |
| RF06 lote com prévia, resultado por item e CAS | implementado e validado | e1 |
| RF07 rodízio 50/50, concorrência, fila sem perda | implementado e validado | e1 + hours.test |
| RF26 canais | permanece o adaptador de teste (homologação externa) | — |
| RF27/28/29 setores, categorias, equipe | CRUD implementado e validado | e1 |
| RF30 auditoria filtrável (payload sanitizado) | implementado e validado | e1 |
| RF08–RF25, RF31–RF38 | não implementados nesta etapa (E2–E5) | — |
| RF39 clientes/contratos/faturas | preservado | records 9/9 |

## Contrato do rodízio (desenho próprio)
Percentual = quota em ciclo de 100. Escolha: menor razão atribuído/percentual; empate: menos atribuições totais, depois `memberId`. Sem elegível (presença, expediente, capacidade, setor) o ticket permanece na fila ou vai **uma vez** ao setor de fallback. Quota não usada no ciclo não vira dívida.

## Como abrir
`npm run dev` (Next + worker). Sem SGP e sem NestJS. Novas áreas: `/team`, `/boards`, `/history`, `/audit`.
Recuperação: `/forgot-password` (resposta genérica) e link emitido por administrador em `/team`.
