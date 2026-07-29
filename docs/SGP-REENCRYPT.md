# Re-criptografia administrativa de credenciais SGP

Este documento descreve a rotina **offline** para corrigir `Integration.encryptedSecrets` quando a `ENCRYPTION_KEY` atual não consegue descriptografar o blob armazenado — **sem apagar** clientes, contratos, faturas ou históricos de sync.

## O que a rotina faz

| Ação | Altera |
|------|--------|
| Re-criptografia (`--execute`) | **Somente** `Integration.encryptedSecrets` |
| Restauração (`--restore --execute`) | **Somente** `Integration.encryptedSecrets` |
| Dry-run (padrão) | Nada (ROLLBACK) |

**Não altera:** `Customer`, `Contract`, `Invoice`, `IntegrationSyncRun`, `IntegrationSyncLog`, nem colunas não listadas em `Integration`.

## Pré-requisitos

- PostgreSQL acessível via `DATABASE_URL`
- `ENCRYPTION_KEY` atual (≥ 32 caracteres) — **chave destino**
- Credenciais SGP corretas em variáveis de ambiente (re-criptografia)
- IDs exatos da integração e do tenant

## Variáveis de ambiente

### Obrigatórias (todos os modos)

| Variável | Descrição |
|----------|-----------|
| `DATABASE_URL` | Conexão PostgreSQL |
| `REENCRYPT_TENANT_ID` | UUID do tenant |
| `REENCRYPT_INTEGRATION_ID` | UUID da integração SGP |
| `REENCRYPT_CONFIRM_ID` | Deve ser **idêntico** a `REENCRYPT_INTEGRATION_ID` |

### Re-criptografia (`--execute`)

| Variável | Descrição |
|----------|-----------|
| `ENCRYPTION_KEY` | Chave usada para **gravar** o novo blob |
| `SGP_APP` | App SGP (não logado pelo script) |
| `SGP_TOKEN` | Token SGP (não logado pelo script) |

### Restauração (`--restore --execute`)

| Variável | Descrição |
|----------|-----------|
| `ENCRYPTION_KEY` | Chave que deve descriptografar o ciphertext do backup |
| `--backup-file=` | Caminho do JSON de backup (CLI — não contém segredo novo) |

### Opcionais

| Variável | Descrição |
|----------|-----------|
| `REENCRYPT_BACKUP_DIR` | Diretório de backup (padrão: `../isp-crm-integration-backups` fora do repo) |
| `REENCRYPT_ALLOW_PRODUCTION` | Deve ser `I_UNDERSTAND_THE_RISK` se `NODE_ENV=production` |

## Segredos nunca via CLI

**Não passe** `SGP_TOKEN`, `SGP_APP`, `ENCRYPTION_KEY` ou `DATABASE_URL` como argumentos de linha de comando — eles ficam no histórico do PowerShell.

Use somente variáveis de ambiente:

```powershell
$env:SGP_APP = "siac"
$env:SGP_TOKEN = "seu-token"
$env:ENCRYPTION_KEY = "sua-chave-com-pelo-menos-32-caracteres"
$env:REENCRYPT_TENANT_ID = "uuid-do-tenant"
$env:REENCRYPT_INTEGRATION_ID = "uuid-da-integracao"
$env:REENCRYPT_CONFIRM_ID = "uuid-da-integracao"
```

## Descobrir o integrationId (sem descriptografar)

Consulta SQL segura (somente metadados):

```sql
SELECT id, "tenantId", name, provider, status, config->>'apiUrl' AS api_url, "createdAt"
FROM "Integration"
WHERE provider = 'SGP'
ORDER BY "createdAt";
```

## Modos de operação

### 1. Dry-run — re-criptografia (padrão)

Pré-visualiza alterações. **Nenhum COMMIT.**

```powershell
npm run reencrypt:sgp-integration
```

ou explicitamente:

```powershell
node scripts/reencrypt-sgp-integration.mjs --dry-run
```

### 2. Executar re-criptografia

1. Cria backup JSON com ciphertext **completo** (fora do repo, permissão restrita)
2. Valida descriptografia do novo blob com a chave atual (sem imprimir conteúdo)
3. Atualiza `encryptedSecrets`
4. Verifica contagens e checksums de IDs
5. Aborta e faz ROLLBACK se qualquer dado importado ou coluna protegida mudar

```powershell
node scripts/reencrypt-sgp-integration.mjs --execute
```

### 3. Dry-run — restauração

```powershell
node scripts/reencrypt-sgp-integration.mjs --restore --backup-file=C:\caminho\para\backup.json
```

### 4. Executar restauração

Restaura o ciphertext exato do backup em `encryptedSecrets`.

```powershell
node scripts/reencrypt-sgp-integration.mjs --restore --backup-file=C:\caminho\para\backup.json --execute
```

`--restore` combinado com `--execute` restaura o ciphertext do backup.

## Formato do backup

Arquivo JSON (fora do repositório, modo `600`):

- Metadados: `tenantId`, `integrationId`, `createdAt`, hash SHA-256
- `integration.encryptedSecrets`: ciphertext **completo** restaurável
- Demais colunas da integração para auditoria (sem expor segredos em claro)

O console exibe apenas hashes e campos não secretos — **nunca** o ciphertext.

## Proteção em produção

Se `NODE_ENV=production`, o script aborta unless:

```powershell
$env:REENCRYPT_ALLOW_PRODUCTION = "I_UNDERSTAND_THE_RISK"
```

## Validação pós-execução

1. `GET /api/integrations/sgp/credentials` deve retornar **200** (não 500)
2. Relatório JSON do script: `integrity.before` = `integrity.after`
3. Sync manual SGP no CRM

## Testes automatizados

```powershell
npm run test:reencrypt-sgp-integration
```

Os testes unitários usam mocks — nunca `DATABASE_URL` real.

Teste de integração real em PostgreSQL descartável (porta `55999`, banco `reencrypt_disposable_test`):

```powershell
npm run test:reencrypt-sgp-integration:live
```

Esse teste usa `embedded-postgres` (ou Docker `pgvector/pgvector:pg16` quando disponível) e **nunca** conecta ao banco de desenvolvimento/produção.

## Rollback operacional

Se a re-criptografia foi executada com credenciais erradas mas o backup foi gerado:

```powershell
node scripts/reencrypt-sgp-integration.mjs --restore --backup-file=CAMINHO_DO_BACKUP --execute
```

## Riscos

| Risco | Mitigação |
|-------|-----------|
| Token/app incorretos | Dry-run + validação SGP após |
| ID de integração errado | `REENCRYPT_CONFIRM_ID` + dry-run exibe `name`/`apiUrl` |
| Backup exposto | Fora do repo, `.gitignore`, chmod 600 |
| Alteração acidental de dados | Checksums de IDs + rollback automático |
