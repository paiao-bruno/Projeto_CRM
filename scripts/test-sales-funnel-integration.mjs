#!/usr/bin/env node
/**
 * Teste de integração do funil em banco descartável.
 * Requer PostgreSQL local (ex.: docker compose up -d postgres).
 */
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { PrismaClient, DealStatus } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://crm:crm@localhost:5432/isp_crm?schema=public";

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function main() {
  const admin = new Client({ connectionString: DATABASE_URL });
  await admin.connect();
  await admin.query("DROP SCHEMA IF EXISTS public CASCADE");
  await admin.query("CREATE SCHEMA public");
  await admin.end();

  run("npx", ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"]);
  run("npx", ["prisma", "generate", "--schema", "prisma/schema.prisma"]);

  const pool = new Client({ connectionString: DATABASE_URL });
  await pool.connect();
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  const tenant = await prisma.tenant.create({
    data: { name: "Tenant Funil", slug: "tenant-funil-test", status: "ACTIVE" },
  });
  const user = await prisma.user.create({
    data: {
      email: "funil@test.local",
      name: "Funil Test",
      passwordHash: "hash",
      status: "ACTIVE",
    },
  });
  const role = await prisma.role.create({
    data: {
      tenantId: tenant.id,
      name: "Admin",
      scope: "TENANT",
    },
  });
  const member = await prisma.tenantMember.create({
    data: {
      tenantId: tenant.id,
      userId: user.id,
      roleId: role.id,
      displayName: "Funil Test",
      status: "ACTIVE",
    },
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
  const stage = pipeline.stages[0];

  const deal = await prisma.deal.create({
    data: {
      tenantId: tenant.id,
      pipelineId: pipeline.id,
      stageId: stage.id,
      title: "Lead Integração",
      createdByMemberId: member.id,
      updatedByMemberId: member.id,
      ownerMemberId: member.id,
      position: 0,
      status: DealStatus.OPEN,
    },
  });

  await prisma.dealHistory.create({
    data: {
      tenantId: tenant.id,
      dealId: deal.id,
      action: "created",
      actorMemberId: member.id,
      newValue: { title: deal.title },
    },
  });

  const activation = pipeline.stages.find((item) => item.code === "ATIVACAO");
  await prisma.deal.update({
    where: { id: deal.id },
    data: { stageId: activation!.id, status: DealStatus.WON, version: { increment: 1 } },
  });

  await prisma.dealHistory.create({
    data: {
      tenantId: tenant.id,
      dealId: deal.id,
      action: "stage_changed",
      actorMemberId: member.id,
      newValue: { stageCode: "ATIVACAO" },
    },
  });

  const wonCount = await prisma.deal.count({
    where: { tenantId: tenant.id, status: DealStatus.WON },
  });
  const historyCount = await prisma.dealHistory.count({
    where: { tenantId: tenant.id, dealId: deal.id },
  });

  await prisma.$disconnect();
  await pool.end();

  console.log(
    JSON.stringify(
      {
        ok: wonCount === 1 && historyCount >= 2,
        wonCount,
        historyCount,
      },
      null,
      2,
    ),
  );

  if (wonCount !== 1 || historyCount < 2) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
