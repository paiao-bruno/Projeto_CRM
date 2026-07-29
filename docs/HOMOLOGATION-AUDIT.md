# Auditoria estática — homologação SGP

Auditoria de leitura (jul/2026). **Não executada** nesta sessão.

## Variáveis obrigatórias

| Variável | Carregamento | Script |
|----------|--------------|--------|
| `SGP_API_URL` | `process.env` / PowerShell `$env:` | homologate |
| `SGP_APP` | idem | homologate |
| `SGP_TOKEN` | idem | homologate |
| `BOOTSTRAP_ADMIN_EMAIL` ou `ADMIN_EMAIL` | idem | homologate |
| `BOOTSTRAP_ADMIN_PASSWORD` ou `ADMIN_PASSWORD` | idem | homologate |
| `DATABASE_URL` | default `localhost:5432/isp_crm` | homologate |
| `RATE_LIMIT_MAX` | default `5000` na API temporária | homologate |
| `ENCRYPTION_KEY` | fallback de validação se ausente | homologate API spawn |

## Duplicidade SGP / SGP Homologação

**Comportamento atual (`homologate-sgp-real.mjs`):**

- Lista credenciais existentes via `GET /integrations/sgp/credentials`
- Reutiliza se `apiUrl === SGP.apiUrl`
- Caso contrário cria `"SGP Homologação"`

**Pendente/risco:**

- Duas integrações com **mesma URL** mas nomes diferentes → reutiliza corretamente
- Duas integrações com URLs diferentes → acumula registros (esperado)
- Nome fixo `"SGP Homologação"` pode colidir com registro manual homônimo → **erro 400 nome duplicado ainda possível** se nome existir com URL diferente

## Idempotência de credenciais

| Cenário | Status |
|---------|--------|
| Mesma `apiUrl` | Reutiliza ID — **corrigido** |
| Nome duplicado, URL nova | **Pendente** — POST falha |
| Ciphertext corrompido (ENCRYPTION_KEY) | **Pendente operacional** — requer reencrypt, não homologação |

## Endpoints SGP diretos

| ID | Path | Método | Problema histórico |
|----|------|--------|-------------------|
| sgp-customers | `/api/ura/clientes/` | POST | OK |
| sgp-contracts | `/api/contrato/list/` | POST | **HTTP 405** em algumas instâncias SGP |
| sgp-invoices | `/api/ura/titulos/` | POST | OK |

**405 contratos:** homologação **registra FAIL** mas continua. Sync CRM usa endpoints dedicados na API (corrigido em commits anteriores de sync). Homologação ainda testa path direto que pode 405 — **parcialmente pendente** (aceitável como sinal, não bloqueia sync interna).

## Retry / backoff HTTP 429

| Local | Status |
|-------|--------|
| Paginação homologação (`wait(150)` entre páginas) | **Corrigido** |
| `RATE_LIMIT_MAX=5000` no spawn da API | **Corrigido** |
| Retry automático em 429 SGP direto | **Não implementado** |
| Retry em sync CRM | Depende da API (fora do script homologate) |

## sync-full / sync-incremental

- Full: `POST /integrations/sgp/sync-customers` com `{ full: true }`
- Incremental: mesmo endpoint sem `full`
- Valida contagens DB antes/depois
- Segunda sync consecutiva verifica duplicação

**Risco:** homologação **modifica dados reais** (upsert clientes/contratos/faturas). Não é read-only.

## Rate limit efetivo

- API homologação sobe com `RATE_LIMIT_MAX` elevado
- Paginação CRM pausa 150ms
- SGP externo pode ainda retornar 429 — **sem backoff exponencial global**

## Relatório `homologation-report.json`

- Gerado/sobrescrito na raiz do repo a cada execução
- Listado no `.gitignore` — **OK**
- Contém `adminEmail`, hashes parciais; token SGP **não** serializado (`tokenConfigured: true`)

## Problemas históricos — status no código

| Problema | Corrigido? | Evidência |
|----------|------------|-----------|
| `timeoutMs` no teste credenciais 400 | **Sim** | DTO homologação |
| Rate limit paginação 429 | **Parcial** | pausa + RATE_LIMIT_MAX |
| ENCRYPTION_KEY / credentials 500 | **Operacional** | reencrypt script |
| Nome credencial duplicado | **Parcial** | reutiliza por URL |
| sgp-contracts 405 | **Detectado, não contornado** | step FAIL esperado |
| sync contratos/faturas | **Sim (API)** | commits sync dedicados |
| Bootstrap vars ausentes | **Documentado** | skip com exit 2 |
| `npm run build` no Windows homologate | **Pendente** | shell: false |

## Recomendações antes de homologar

1. Executar reencrypt + validar `GET /credentials` 200
2. Confirmar uma integração SGP por URL
3. Executar homologação fora de horário de pico SGP
4. Revisar `homologation-report.json` antes de considerar aprovado
5. No Windows: verificar builds manuais se `spawnSync npm` falhar
