# 09 — Procedimento da prova de independência

`npm run test:site-e2e` (`scripts/test-site-e2e.mjs`) cria um PostgreSQL descartável, remove do ambiente
`SGP_*`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WEB_ONLY_MODE` e `LEGACY_API_ENABLED`, faz `next build`, sobe
`next start` e o worker com `NODE_OPTIONS=--require scripts/lib/network-guard.cjs`.

O guard bloqueia (`ENETGUARD`) e registra qualquer conexão a host que não seja loopback e qualquer conexão à porta 4000.
O teste confirma que a porta 4000 está livre, que o guard funciona (autoteste contra `192.0.2.1`) e, no fim,
que o log do guard está **vazio**. Etapas: health single-site; rotas do menu; CRUD local; isolamento entre
organizações; permissões; webhook assinado (401/401/200/duplicado/413) com evento SSE; resposta → outbox → worker →
ACCEPTED/DELIVERED e timeout → UNKNOWN; funil; persistência após reinício.

Por que modo produção: o `next dev` consulta `registry.npmjs.org` (verificação de versão do próprio tooling).
O guard flagrou isso, o que confirmou que ele funciona; para não misturar tráfego do tooling com o da
aplicação, a prova roda o servidor de produção.

Limite: o guard cobre conexões feitas pelo processo Node (Next e worker). Não cobre navegador nem
outros processos. Não substitui homologação com provedores reais (não executada).
