# Prisma migrations

Este projeto usa exclusivamente `prisma migrate` (não utiliza `db push`).

## Estrutura

- `20260708160000_init/` — baseline completa do schema (extensions, enums, tabelas, índices e FKs).
- Novas alterações devem ser adicionadas como migrations incrementais com timestamp (`YYYYMMDDHHMMSS_descricao`).

## Comandos

```bash
npm run db:migrate:deploy   # aplica migrations em produção/CI (idempotente via _prisma_migrations)
npm run db:migrate          # cria/aplica migrations em desenvolvimento
npm run db:migrate:status   # status das migrations
npm run db:migrate:reset    # recria o banco local (apenas dev)
```

## Boas práticas para migrations incrementais

Preferir SQL idempotente quando aplicável:

- `CREATE EXTENSION IF NOT EXISTS ...`
- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`
- `CREATE INDEX IF NOT EXISTS ...`
- `ALTER TYPE ... ADD VALUE IF NOT EXISTS ...`

Constraints e FKs novas devem usar nomes explícitos e ser aplicadas uma única vez por migration.
