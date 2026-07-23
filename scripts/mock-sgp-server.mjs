#!/usr/bin/env node
import http from "node:http";

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

  const offset = Number(payload.offset ?? payload.pagina ?? 0);
  const limit = Number(payload.limit ?? payload.limite ?? 100);
  const pageItems = customers.slice(offset, offset + limit);

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      clientes: pageItems,
      total: customers.length,
      pagina: Math.floor(offset / limit) + 1,
    }),
  );
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Mock SGP server listening on http://127.0.0.1:${PORT}`);
});
