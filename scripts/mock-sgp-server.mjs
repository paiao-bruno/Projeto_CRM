#!/usr/bin/env node
import http from "node:http";
import { URL } from "node:url";

const PORT = Number(process.env.MOCK_SGP_PORT ?? 9090);

const customers = [
  {
    id: "1001",
    nome: "Cliente A",
    cpfcnpj: "11111111111",
    data_alteracao: "20/07/2026 10:00:00",
  },
  {
    id: "1002",
    nome: "Cliente B",
    cpfcnpj: "22222222222",
    data_alteracao: "20/07/2026 10:00:00",
  },
  {
    id: "1003",
    nome: "Cliente C",
    cpfcnpj: "33333333333",
    data_alteracao: "20/07/2026 10:00:00",
  },
];

const contracts = customers.map((customer) => ({
  id: `contract-${customer.id}`,
  contrato: `contract-${customer.id}`,
  cliente_id: customer.id,
  status: "ATIVO",
  plano: "Plano 600 Mega",
}));

const invoices = customers.map((customer) => ({
  id: `invoice-${customer.id}`,
  titulo: `invoice-${customer.id}`,
  cliente_id: customer.id,
  contrato: `contract-${customer.id}`,
  valor: "99,90",
  status: "ABERTO",
  vencimento: "20/08/2026",
}));

function paginate(items, payload) {
  const offset = Number(payload.offset ?? 0);
  const limit = Number(payload.limit ?? payload.limite ?? 100);
  const pageItems = items.slice(offset, offset + limit);

  return {
    items: pageItems,
    pagination: {
      offset,
      limit,
      total: items.length,
      pagina: Math.floor(offset / limit) + 1,
      next: offset + limit < items.length,
    },
  };
}

function resolvePayload(url, payload) {
  const pathname = url.pathname.toLowerCase();

  if (pathname.includes("/contrato/")) {
    const page = paginate(contracts, payload);
    return { contratos: page.items, ...page.pagination };
  }

  if (pathname.includes("/titulos") || pathname.includes("/titulo")) {
    const page = paginate(invoices, payload);
    return { titulos: page.items, ...page.pagination };
  }

  const page = paginate(customers, payload);
  return { clientes: page.items, ...page.pagination };
}

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }

  let body = "";
  for await (const chunk of req) {
    body += chunk;
  }

  let payload = {};
  try {
    payload = body ? JSON.parse(body) : {};
  } catch {
    payload = {};
  }

  if (!payload.app || !payload.token) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const responseBody = resolvePayload(url, payload);

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(responseBody));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Mock SGP server listening on http://127.0.0.1:${PORT}`);
});
