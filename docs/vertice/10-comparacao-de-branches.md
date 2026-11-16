# 10 — Comparação de branches (sem merge, rebase ou reconciliação)

Medido com `git rev-list --left-right --count HEAD...<branch>` (esquerda = só no HEAD, direita = só na outra).

| Branch | SHA | Só no HEAD | Só na branch | Observação |
|---|---|---|---|---|
| `main` | 2923db8 | 77 | 0 | Ancestral do HEAD. |
| `homologation-fixes` | f970dcc | 6 | 0 | Ancestral do HEAD. |
| `production-readiness` | 105b7cf | 33 | 0 | Ancestral do HEAD. |
| `fix-sgp-data-regression` | 6a2cf12 | 30 | 0 | Ancestral do HEAD. |
| `isp-crm-architecture` | e38fbd1 | 27 | 5 | **Divergente.** |

A única divergência real é `isp-crm-architecture`: 5 commits (rotina administrativa de re-criptografia SGP,
fixes de teste live, lockfile e `.gitignore`). O HEAD já contém uma versão diferente dos mesmos arquivos
(`scripts/*reencrypt-sgp-integration*`, `docs/SGP-REENCRYPT.md`): `git diff --stat HEAD <branch>` nesses 5 arquivos
mostra +290/−1628, ou seja, a versão do HEAD é a maior. `package-lock.json` e `.gitignore` também diferem.
Reconciliar exige decidir qual implementação vale e regenerar o lockfile. **Não foi feito**; fica como decisão
do usuário. Nada foi alterado em `main`.
