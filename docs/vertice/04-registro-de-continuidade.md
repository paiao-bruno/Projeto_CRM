> **Nota:** `(vertice)/`, `test-inbox-e2e.mjs` e o menu "legado intacto" descritos abaixo foram superados pela unificação em um site único; ver `05` a `10`.

# 04 — Registro de continuidade (checkpoint)

**Data:** 28/10/2026 · **Branch:** `cursor/vertice-foundation-edc0` (a partir de `f970dcc`)

## O que existe agora

- `prisma/schema.prisma` + `prisma/migrations/20261028120000_vertice_inbox_core/` (aditiva).
- `apps/web/src/server/inbox/{rules.ts,service.ts}` (+ `rules.test.ts`, `inbox.integration.ts`).
- `apps/web/src/app/api/inbox/[...path]/route.ts`.
- `apps/web/src/lib/{brand.ts,inbox-client.ts}` (+ testes), `apps/web/src/components/vertice/shell.tsx`,
  `apps/web/src/app/(vertice)/{layout.tsx,vertice.css,inbox/page.tsx}`.
- `scripts/test-inbox-integration.mjs`, `scripts/test-inbox-e2e.mjs`, scripts npm `test:inbox-integration` / `test:inbox-e2e`.
- `docs/vertice/*`.

## Limites conhecidos

1. Sem envio real: respostas ficam `RECORDED_ONLY`.
2. Polling de 5 s; sem WebSocket.
3. `/inbox` não está no menu legado (decisão do usuário).
4. A tela exige modo web-only.
5. Simulador de entrada ativo fora de produção (`VERTICE_DEMO_INBOUND=false` desliga).
6. Branches `isp-crm-architecture` e `homologation-fixes` seguem divergentes.

## Próxima ação exata (ordem sugerida)

1. Usuário valida no Windows (`docs/vertice/README.md`) e decide: link no menu, reconciliação das branches.
2. Outbox + worker com lease/fencing e adaptador de canal "dry-run" (invariantes de envio), com teste de falha/duplo envio.
3. Webhook de entrada assinado (HMAC) por conexão, reaproveitando `ingestInbound`.
4. M05 rodízios usando presença e capacidade; M06 duplicidades.
5. M07/M08 tarefas e calendário ligados à conversa.

## Comandos de retomada

```bash
git checkout cursor/vertice-foundation-edc0 && npm install && npm run prisma:generate
INBOX_TEST_ADMIN_URL="postgresql://USER:PASS@localhost:PORT/postgres" npm run test:inbox-integration
```
