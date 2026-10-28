#!/usr/bin/env node
/**
 * Integração do Funil de Vendas contra PostgreSQL real e isolado (um banco por execução).
 * Pré-requisito: TEST_DATABASE_ADMIN_URL (ver scripts/lib/test-db-harness.mjs).
 *
 * TEST_NEGATIVE_CONTROL=1 inverte uma expectativa de propósito: o comando DEVE falhar
 * (usado por scripts/test-harness.spec.mjs para provar que falhas produzem exit code != 0).
 */
import assert from "node:assert/strict";
import { PrismaPg } from "@prisma/adapter-pg";
import { DealStatus, PrismaClient } from "@prisma/client";
import {
  generatePrismaClient,
  migrateDeploy,
  runCli,
  withDisposableDatabases,
} from "./lib/test-db-harness.mjs";

const negativeControl = process.env.TEST_NEGATIVE_CONTROL === "1";

async function scenario(prisma) {
  const tenant = await prisma.tenant.create({
    data: { name: "Tenant Funil", slug: "tenant-funil-test", status: "ACTIVE" },
  });
  const other = await prisma.tenant.create({
    data: { name: "Outra Org", slug: "outra-org-test", status: "ACTIVE" },
  });
  const user = await prisma.user.create({
    data: { email: "funil@test.local", name: "Funil Test", passwordHash: "hash", status: "ACTIVE" },
  });
  const role = await prisma.role.create({ data: { tenantId: tenant.id, name: "Admin", scope: "TENANT" } });
  const member = await prisma.tenantMember.create({
    data: { tenantId: tenant.id, userId: user.id, roleId: role.id, displayName: "Funil Test", status: "ACTIVE" },
  });
  const pipeline = await prisma.pipeline.create({
    data: {
      tenantId: tenant.id,
      name: "Funil de Vendas",
      isDefault: true,
      stages: {
        create: [
          { tenantId: tenant.id, name: "Prospecção", code: "PROSPECCAO", position: 1 },
          { tenantId: tenant.id, name: "Ativação", code: "ATIVACAO", position: 6 },
        ],
      },
    },
    include: { stages: true },
  });
  const deal = await prisma.deal.create({
    data: {
      tenantId: tenant.id,
      pipelineId: pipeline.id,
      stageId: pipeline.stages.find((item) => item.code === "PROSPECCAO").id,
      title: "Lead Integração",
      createdByMemberId: member.id,
      updatedByMemberId: member.id,
      ownerMemberId: member.id,
      position: 0,
      status: DealStatus.OPEN,
    },
  });
  await prisma.dealHistory.create({
    data: { tenantId: tenant.id, dealId: deal.id, action: "created", actorMemberId: member.id, newValue: { title: deal.title } },
  });

  const activation = pipeline.stages.find((item) => item.code === "ATIVACAO");
  assert.ok(activation, "etapa ATIVACAO deve existir");
  await prisma.deal.update({
    where: { id: deal.id },
    data: { stageId: activation.id, status: DealStatus.WON, version: { increment: 1 } },
  });
  await prisma.dealHistory.create({
    data: { tenantId: tenant.id, dealId: deal.id, action: "stage_changed", actorMemberId: member.id, newValue: { stageCode: "ATIVACAO" } },
  });

  const wonCount = await prisma.deal.count({ where: { tenantId: tenant.id, status: DealStatus.WON } });
  const historyCount = await prisma.dealHistory.count({ where: { tenantId: tenant.id, dealId: deal.id } });
  const crossTenant = await prisma.deal.count({ where: { tenantId: other.id } });
  const versionAfter = (await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).version;

  assert.equal(wonCount, negativeControl ? 2 : 1, "oportunidades ganhas da organização");
  assert.ok(historyCount >= 2, "histórico deve registrar criação e mudança de etapa");
  assert.equal(crossTenant, 0, "outra organização não enxerga a oportunidade");
  assert.equal(versionAfter, 2, "versão otimista deve incrementar uma vez");
  return { wonCount, historyCount, crossTenant, versionAfter };
}

await runCli(async () => {
  const summary = await withDisposableDatabases({}, async (ctx) => {
    migrateDeploy(ctx);
    generatePrismaClient();
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: ctx.databaseUrl }) });
    try {
      return await scenario(prisma);
    } finally {
      await prisma.$disconnect();
    }
  });
  console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
});
