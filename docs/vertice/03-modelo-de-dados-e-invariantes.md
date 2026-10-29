# 03 — Modelo de dados e invariantes (Caixa de entrada)

Migration `20261028120000_vertice_inbox_core` (aditiva):

| Alteração | Finalidade |
|---|---|
| `Conversation.protocol` (único por organização) | Protocolo legível `AAAAMMDD-NNNNN` |
| `Conversation.version` (default 1) | Fencing / compare-and-set |
| `Conversation.unreadCount`, `claimedAt` | Não lidas e momento da assunção |
| `InboundEvent (tenantId, provider, providerEventId)` único | Deduplicação de eventos de entrada |
| `ConversationEvent` | Histórico (criada, assumida, transferida, encerrada, reaberta) |
| `TenantCounter (tenantId, key)` | Sequência atômica de protocolos por organização |

## Invariantes e onde são garantidos

| Invariante | Mecanismo | Teste |
|---|---|---|
| Evento repetido não duplica contato/conversa/mensagem | `createMany(skipDuplicates)` = `INSERT … ON CONFLICT DO NOTHING` na mesma transação | integração: replay e 10 entregas simultâneas |
| Mesmo id com conteúdo diferente é sinalizado | `payloadHash` | integração: `payloadMismatch` |
| Uma conversa aberta por contato, um contato por telefone | `pg_advisory_xact_lock(org:telefone)` | integração: 6 eventos paralelos |
| Protocolos únicos e sequenciais | `INSERT … ON CONFLICT DO UPDATE … RETURNING` | integração: 12 paralelos = 1..12 |
| Exatamente um vencedor ao assumir | `UPDATE … WHERE version = :lida AND assignedMemberId IS NULL` | integração: 8 atendentes → 1 sucesso, 7×409 |
| Alteração com versão antiga falha sem efeito | `expectedVersion` + CAS | integração + E2E |
| Isolamento entre organizações | `tenantId` em toda consulta; 404 (sem vazar existência) | integração: leitura, claim, reply, lista e busca |
| Atendente só vê fila e as próprias; supervisor (`chat.transfer`) vê todas | `rules.ts` + filtros por aba | unidade + integração |
| Resposta não duplica ao reenviar | `externalId = out:<membro>:<clientMessageId>` único | integração + E2E |
| Nenhuma mensagem real é enviada | resposta marcada `RECORDED_ONLY` | integração + UI |

## Rotas (`/api/inbox/*`, Bearer JWT; exigem `chat.read`)

`GET conversations?tab=queue|mine|all|closed&search=&page=&limit=` · `GET conversations/:id` ·
`GET members` · `GET capabilities` · `POST presence` · `POST conversations/:id/{claim,transfer,close,reopen,messages,read}` ·
`POST demo-inbound` (somente `chat.transfer` e fora de produção).

Códigos: 401 sem token, 403 sem permissão, 404 inexistente/de outra organização, 409 conflito de versão/assumida, 422 validação.
