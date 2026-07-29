# Auditoria de compatibilidade Windows — scripts SGP/reencrypt

Auditoria estática (jul/2026). Nenhum banco real, API ou homologação foi executada.

## Resumo executivo

| Severidade | Quantidade | Status |
|------------|------------|--------|
| Crítico (corrigido nesta branch) | 2 | `npx` sem shell; erro `undefined` no migrate |
| Alto (pendente em outros scripts) | 4 | `npm run`/`npx` em homologação e dev |
| Médio | 3 | paths, chmod, quoting |
| Baixo | 2 | mensagens pg/SASL |

## Inventário de subprocessos

### `scripts/reencrypt-sgp-integration.integration.mjs`

| Comando | shell | Windows | Notas |
|---------|-------|---------|-------|
| `docker info/exec/run/rm` | false | OK | Docker Desktop expõe CLI |
| `node prisma/build/index.js migrate deploy` | false | **OK (corrigido)** | Substitui `npx prisma` |
| `node scripts/reencrypt-sgp-integration.mjs` | false | OK | `.mjs` direto |

### `scripts/reencrypt-sgp-integration.mjs`

| Comando | shell | Windows | Notas |
|---------|-------|---------|-------|
| `pg.Client.connect` | n/a | OK | Validação prévia evita SASL opaco |

### `scripts/homologate-sgp-real.mjs`

| Comando | shell | Windows | Risco |
|---------|-------|---------|-------|
| `spawn("node", ["apps/api/dist/main.js"])` | false | OK | |
| `spawnSync("npm", ["run", "build", ...])` | **false** | **FALHA provável** | `.cmd` no Windows |
| `spawnSync("node", ["scripts/audit-sgp-regression.mjs"])` | false | OK | |

**Recomendação:** usar `shell: process.platform === "win32"` ou invocar `node node_modules/...` como em `test-migrate-deploy.mjs`.

### `scripts/test-migrate-deploy.mjs` / `scripts/dev.mjs` / `scripts/ensure-db.mjs`

| Padrão | Windows |
|--------|---------|
| `shell: process.platform === "win32"` para `npx`/`npm` | **Correto — referência** |

### `scripts/validate-sgp-integration.mjs` / `scripts/load-test.mjs`

| Comando | shell | Risco |
|---------|-------|-------|
| `spawnSync("npm", ...)` | false | **Alto no Windows** |

## Pontos que funcionam no Linux e falham no Windows

1. **`spawnSync("npx", [...], { shell: false })`** — ENOENT; stderr/stdout vazios → mensagem `undefined`. **Corrigido** no teste live via `process.execPath` + `node_modules/prisma/build/index.js`.

2. **`spawnSync("npm", [...], { shell: false })`** — homologação e load-test ainda expostos.

3. **`fs.chmodSync` em backups** — ignorado no Windows (já tratado com try/catch).

4. **Paths com `/` vs `\`** — Node `path.join`/`path.resolve` mitigam; URLs PostgreSQL devem usar `/`.

5. **Port check via `net.createServer().listen(port, host)`** — funciona no Windows; firewall pode bloquear bind em alguns hosts.

6. **Variáveis de ambiente PowerShell** — `$env:VAR` persiste na sessão; segredos no histórico se inline. Usar `Read-Host -AsSecureString` (documentado em `SGP-REENCRYPT.md`).

7. **Quoting de `--backup-file=C:\...`** — paths com espaços exigem aspas no PowerShell; preferir variável ou forward slashes.

## Captura de erros de subprocesso

**Antes:** apenas `proc.stderr` → `undefined` quando spawn falha.

**Depois (live test):** `formatSubprocessFailure` reporta comando, cwd, exitCode, signal, error.message, stdout, stderr sanitizados.

**Pendente:** aplicar o mesmo helper em homologação/build se necessário.

## Checklist operacional Windows

- [ ] Docker Desktop rodando antes do teste live
- [ ] Porta 55999 livre
- [ ] Container `isp-crm-reencrypt-test` ausente antes do live
- [ ] `node --version` ≥ 20
- [ ] Preflight (`--preflight`) antes de dry-run
- [ ] Nunca usar `npx prisma` manualmente sem shell no PowerShell — preferir `npm run db:migrate:deploy`
