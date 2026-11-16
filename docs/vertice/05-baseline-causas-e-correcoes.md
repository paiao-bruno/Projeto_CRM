# 05 — Baseline, causas confirmadas e correções (Frente A1)

Baseline bruto (antes de qualquer correção): [evidence/00-baseline-failures.txt](evidence/00-baseline-failures.txt),
coletado em `56da9c8`, Node v22.23.4, ambiente limpo.

| Item | Causa confirmada | Correção | Verificação |
|---|---|---|---|
| `test:sales-funnel-integration` | O script `.mjs` continha sintaxe TypeScript (`activation!.id`) e herdava `ALLOW_DISPOSABLE_DB=true`, sem banco descartável de fato. | Script reescrito em JS válido sobre o harness `scripts/lib/test-db-harness.mjs` (banco `vtest_<runId>` criado e removido a cada execução). | `npm run test:sales-funnel-integration` → exit 0 |
| `prisma:validate:migrations` | Sem `DATABASE_URL` pulava o diff e retornava OK (falso positivo); com `DATABASE_URL` o shadow vinha de `prisma.config.ts` (porta 5432 inexistente). | `scripts/validate-prisma.mjs` + `scripts/lib/migration-checks.mjs`: 5 camadas (estática, `prisma validate`, histórico em banco vazio, divergência schema×migrations, atualização de dados legados). Shadow DB distinto do datasource. Sem banco de teste disponível o comando **falha** (a menos de `--static-only`, que declara o que não verificou). | `npm run prisma:validate:migrations` → exit 0; `test:harness` cobre os caminhos negativos (14/14) |

## Requisitos da seção 7
1. Harness de banco descartável: `TEST_DATABASE_ADMIN_URL` obrigatório, nunca usa `DATABASE_URL`, recusa host/banco iguais ao de desenvolvimento, nome com `runId`, limpeza garantida.
2. Teste de atualização de dados legados: a migration `20261029100000_local_origin_contracts_invoices` é aditiva; a camada 5 insere dados no esquema anterior e confirma preservação (cliente, contrato, fatura, conversa, mensagem).

## Falha encontrada pelo build de produção
O `next build` (type-check de rotas) rejeitou `route(...)` por causa do segundo parâmetro opcional
(`Context | undefined`). Corrigido em `apps/web/src/server/route-kit.ts` (contexto obrigatório na
assinatura, fallback em tempo de execução). Sem o build de produção isso só apareceria em deploy.

## Falha encontrada nos testes da API legada
O agendador SGP passou a exigir `SGP_LEGACY_SYNC_ENABLED=true`; o spec antigo não definia a variável.
Spec ajustado e teste adicionado para o padrão (inativo).
