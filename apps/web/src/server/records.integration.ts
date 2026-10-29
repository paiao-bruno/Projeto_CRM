/**
 * Integração do cadastro local (clientes, contratos, faturas, agentes, dashboard) contra PostgreSQL
 * descartável. Executar via `npm run test:records-integration`.
 * Nenhuma chamada de rede externa é feita; um guard bloqueia qualquer tentativa de acesso ao SGP.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { AiAgentsService } from "./ai-agents";
import type { ServerAuthUser } from "./auth";
import { DashboardService } from "./dashboard";
import { HttpError } from "./http";
import { jwtSecretKey } from "./jwt-secret";
import { RecordsService } from "./records";
import { route } from "./route-kit";
import { parseMoneyToCents } from "./validation";

const url = process.env.DATABASE_URL ?? "";
const runId = process.env.TEST_DATABASE_RUN_ID ?? "";
if (!runId || !new URL(url).pathname.startsWith(`/vtest_${runId}`)) {
  throw new Error("Recusado: execute via `npm run test:records-integration` (banco exclusivo criado pelo harness).");
}

const blockedRequests: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  blockedRequests.push(String(input));
  throw new Error("Rede externa bloqueada nos testes de independência.");
}) as typeof fetch;

const pool = new Pool({ connectionString: url });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const records = new RecordsService(prisma);
const agents = new AiAgentsService(prisma);
const dashboard = new DashboardService(prisma);

async function seedOrg(slug: string, codes: string[]): Promise<ServerAuthUser> {
  const tenant = await prisma.tenant.create({ data: { name: `Org ${slug}`, slug, status: "ACTIVE" } });
  const user = await prisma.user.create({
    data: { name: `User ${slug}`, email: `u@${slug}.test.local`, passwordHash: "x", status: "ACTIVE" },
  });
  const role = await prisma.role.create({
    data: {
      tenantId: tenant.id,
      name: "Admin",
      permissions: {
        create: await Promise.all(
          codes.map(async (code) => {
            const permission = await prisma.permission.upsert({
              where: { code },
              update: {},
              create: { code, description: code },
            });
            return { permissionId: permission.id };
          }),
        ),
      },
    },
  });
  const member = await prisma.tenantMember.create({
    data: { tenantId: tenant.id, userId: user.id, roleId: role.id, status: "ACTIVE" },
  });
  const session = await prisma.authSession.create({
    data: { userId: user.id, expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return {
    sub: user.id,
    sid: session.id,
    email: user.email,
    name: user.name,
    tenantId: tenant.id,
    tenantName: tenant.name,
    memberId: member.id,
    role: "Admin",
    permissions: codes,
  };
}

async function expectHttp(promise: Promise<unknown>, status: number) {
  await assert.rejects(promise, (error: unknown) => error instanceof HttpError && error.status === status);
}

describe("cadastro local sem SGP", () => {
  let a: ServerAuthUser;
  let b: ServerAuthUser;

  before(async () => {
    process.env.JWT_ACCESS_SECRET = "t".repeat(48);
    a = await seedOrg("rec-a", ["customers.manage", "ai_agents.manage", "dashboard.read"]);
    b = await seedOrg("rec-b", ["customers.manage", "ai_agents.manage", "dashboard.read"]);
  });

  after(async () => {
    globalThis.fetch = realFetch;
    await pool.end();
  });

  it("converte dinheiro em centavos sem ponto flutuante", () => {
    assert.equal(parseMoneyToCents("129,90"), 12990);
    assert.equal(parseMoneyToCents("0.1"), 10);
    assert.equal(parseMoneyToCents(19.99), 1999);
    assert.equal(parseMoneyToCents("1.005".slice(0, 4)), 100);
    for (const bad of ["-1", "1,234", "abc", "", "1e3"]) assert.throws(() => parseMoneyToCents(bad), HttpError);
  });

  it("cria, lista, edita e exclui logicamente cliente, contrato e fatura locais", async () => {
    const customer = await records.createCustomer(a, { name: "Maria Local", document: "123", email: "m@x.com" });
    assert.equal(customer.status, "PROSPECT");
    const contract = await records.createContract(a, { customerId: customer.id, planName: "Fibra 500", serviceLogin: "maria" });
    assert.equal(contract.origin, "LOCAL");
    assert.equal(contract.externalId, null);
    const invoice = await records.createInvoice(a, { customerId: customer.id, contractId: contract.id, amount: "129,90", dueDate: "2026-11-10" });
    assert.equal(invoice.amountCents, 12990);
    assert.equal(invoice.origin, "LOCAL");

    const paid = await records.updateInvoice(a, invoice.id, { status: "PAID" });
    assert.equal(paid.status, "PAID");
    assert.ok(paid.paidAt);
    const reopened = await records.updateInvoice(a, invoice.id, { status: "OPEN" });
    assert.equal(reopened.paidAt, null);

    const listed = await records.listCustomers(a, new URLSearchParams({ search: "maria" }));
    assert.equal(listed.total, 1);
    assert.equal((await records.listContracts(a, new URLSearchParams(), customer.id)).total, 1);
    assert.equal((await records.listInvoices(a, new URLSearchParams(), customer.id)).total, 1);

    const updated = await records.updateCustomer(a, customer.id, { name: "Maria Editada" });
    assert.equal(updated.name, "Maria Editada");

    await records.removeCustomer(a, customer.id);
    await expectHttp(records.getCustomer(a, customer.id), 404);
    await expectHttp(records.getContract(a, contract.id), 404);
    const raw = await prisma.customer.findUnique({ where: { id: customer.id } });
    assert.ok(raw?.deletedAt, "exclusão lógica preserva a linha");
    const audits = await prisma.auditLog.count({ where: { tenantId: a.tenantId, entityType: "Customer", entityId: customer.id } });
    assert.equal(audits, 3);
  });

  it("valida entrada e conflitos", async () => {
    await records.createCustomer(a, { name: "Doc", document: "DUP-1" });
    await expectHttp(records.createCustomer(a, { name: "Doc 2", document: "DUP-1" }), 409);
    await expectHttp(records.createCustomer(a, { name: "" }), 422);
    await expectHttp(records.createCustomer(a, { name: "X", email: "invalido" }), 422);
    await expectHttp(records.createCustomer(a, { name: "X", status: "NOPE" }), 422);
    await expectHttp(records.getCustomer(a, "não-é-uuid"), 422);
  });

  it("isola organizações (leitura, escrita e referências cruzadas)", async () => {
    const customerA = await records.createCustomer(a, { name: "Cliente A" });
    const contractA = await records.createContract(a, { customerId: customerA.id });
    await expectHttp(records.getCustomer(b, customerA.id), 404);
    await expectHttp(records.updateCustomer(b, customerA.id, { name: "invasão" }), 404);
    await expectHttp(records.removeCustomer(b, customerA.id), 404);
    await expectHttp(records.getContract(b, contractA.id), 404);
    await expectHttp(records.createContract(b, { customerId: customerA.id }), 422);
    await expectHttp(records.createInvoice(b, { customerId: customerA.id, amount: "1" }), 422);
    const customerB = await records.createCustomer(b, { name: "Cliente B" });
    await expectHttp(records.createInvoice(b, { customerId: customerB.id, contractId: contractA.id, amount: "1" }), 422);
    assert.equal((await records.listCustomers(b, new URLSearchParams({ search: "Cliente A" }))).total, 0);
  });

  it("fatura não aceita contrato de outro cliente", async () => {
    const c1 = await records.createCustomer(a, { name: "C1" });
    const c2 = await records.createCustomer(a, { name: "C2" });
    const contract = await records.createContract(a, { customerId: c1.id });
    await expectHttp(records.createInvoice(a, { customerId: c2.id, contractId: contract.id, amount: "10" }), 422);
  });

  it("agentes de IA: CRUD, alternância e isolamento", async () => {
    const created = await agents.create(a, { name: "Triagem", provider: "OPENAI", model: "modelo-x", systemPrompt: "Seja breve.", temperature: 0.3 });
    assert.equal(created.status, "ACTIVE");
    const toggled = await agents.toggle(a, created.id);
    assert.equal(toggled.status, "INACTIVE");
    const edited = await agents.update(a, created.id, { description: "novo" });
    assert.equal(edited.description, "novo");
    await expectHttp(agents.get(b, created.id), 404);
    await expectHttp(agents.create(a, { name: "Ruim", provider: "X", model: "m", systemPrompt: "p" }), 422);
    await expectHttp(agents.create(a, { name: "Temp", provider: "OPENAI", model: "m", systemPrompt: "p", temperature: 9 }), 422);
    await agents.remove(a, created.id);
    await expectHttp(agents.get(a, created.id), 404);
  });

  it("dashboard distingue ausência de dados e usa só dados locais", async () => {
    const empty = await seedOrg("rec-empty", ["dashboard.read"]);
    const none = await dashboard.overview(empty);
    assert.equal(none.source, "local");
    for (const key of ["conversations", "customers", "contracts", "invoices", "deals", "aiAgents"] as const) {
      assert.equal(none[key].hasData, false, key);
    }
    const customer = await records.createCustomer(b, { name: "Dash", status: "ACTIVE" });
    await records.createInvoice(b, { customerId: customer.id, amount: "50,00", dueDate: "2020-01-01" });
    const filled = await dashboard.overview(b);
    assert.equal(filled.customers.hasData, true);
    assert.equal(filled.invoices.overdueOpen.count, 1);
    assert.equal(filled.invoices.overdueOpen.amountCents, 5000);
    assert.equal((await dashboard.overview(empty)).invoices.hasData, false);
  });

  it("wrapper de rota exige autenticação, permissão e responde 422/404 padronizados", async () => {
    const sign = (user: ServerAuthUser) => new SignJWT({ ...user }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(jwtSecretKey());
    const handler = route("customers.manage", ({ user, body }) => records.createCustomer(user, body), 201);
    const build = (token: string | null, payload: unknown) =>
      new NextRequest("http://localhost/api/customers", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(payload),
      });
    assert.equal((await handler(build(null, {}), { params: Promise.resolve({}) })).status, 401);
    const reader = await seedOrg("rec-reader", ["chat.read"]);
    const noPerm = await sign(reader);
    assert.equal((await handler(build(noPerm, { name: "x" }), { params: Promise.resolve({}) })).status, 403);
    const ok = await sign(a);
    assert.equal((await handler(build(ok, { name: "" }), { params: Promise.resolve({}) })).status, 422);
    const created = await handler(build(ok, { name: "Via rota" }), { params: Promise.resolve({}) });
    assert.equal(created.status, 201);
    const malformed = new NextRequest("http://localhost/api/customers", { method: "POST", headers: { authorization: `Bearer ${ok}` }, body: "{" });
    assert.equal((await handler(malformed, { params: Promise.resolve({}) })).status, 400);
  });

  it("nenhum acesso de rede externa (SGP) ocorreu", () => {
    assert.deepEqual(blockedRequests, []);
  });
});
