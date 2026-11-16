import { Prisma, type PrismaClient } from "@prisma/client";
import type { ServerAuthUser } from "./auth";
import { recordAudit } from "./audit";
import { HttpError } from "./http";
import { parseTimezone, parseWorkingHours } from "./hours";
import { getPrisma } from "./prisma";
import { optionalString, requireUuid, requiredString, type Body } from "./validation";

const COLOR = /^#([0-9a-fA-F]{6})$/;

function color(body: Body, field = "color") {
  const value = optionalString(body, field, 7);
  if (value === undefined) return undefined;
  if (value === null) return "#64748b";
  if (!COLOR.test(value)) throw new HttpError(422, `${field} deve ser um hexadecimal #RRGGBB.`);
  return value;
}

export class SectorsService {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  listCategories(user: ServerAuthUser) {
    return this.prisma.sectorCategory.findMany({
      where: { tenantId: user.tenantId, archivedAt: null },
      orderBy: { name: "asc" },
      include: { _count: { select: { sectors: true } } },
    });
  }

  async saveCategory(user: ServerAuthUser, body: Body, id?: string) {
    const name = requiredString(body, "name", 80);
    const data = { name, color: color(body) ?? "#64748b" };
    try {
      const row = id
        ? await this.prisma.sectorCategory.updateMany({ where: { id: requireUuid(id), tenantId: user.tenantId }, data })
        : await this.prisma.sectorCategory.create({ data: { ...data, tenantId: user.tenantId } });
      if (id && "count" in row && row.count === 0) throw new HttpError(404, "Categoria não encontrada.");
      const saved = id
        ? await this.prisma.sectorCategory.findFirstOrThrow({ where: { id, tenantId: user.tenantId } })
        : (row as { id: string });
      await recordAudit(this.prisma, user, id ? "sector_category.updated" : "sector_category.created", "SectorCategory", "id" in saved ? saved.id : id!);
      return saved;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(409, "Já existe uma categoria com este nome.");
    }
  }

  async archiveCategory(user: ServerAuthUser, id: string, body: Body) {
    const categoryId = requireUuid(id);
    const inUse = await this.prisma.sector.count({ where: { tenantId: user.tenantId, categoryId, archivedAt: null } });
    const reassignTo = body.reassignToCategoryId ? requireUuid(body.reassignToCategoryId, "reassignToCategoryId") : null;
    if (inUse > 0 && !reassignTo) {
      throw new HttpError(409, `Há ${inUse} setor(es) nesta categoria. Informe reassignToCategoryId ou deixe-os sem categoria.`);
    }
    if (reassignTo === categoryId) throw new HttpError(422, "A categoria de destino deve ser outra.");
    if (reassignTo) {
      const dest = await this.prisma.sectorCategory.findFirst({ where: { id: reassignTo, tenantId: user.tenantId, archivedAt: null } });
      if (!dest) throw new HttpError(422, "Categoria de destino inválida.");
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.sector.updateMany({
        where: { tenantId: user.tenantId, categoryId },
        data: { categoryId: reassignTo },
      });
      const result = await tx.sectorCategory.updateMany({
        where: { id: categoryId, tenantId: user.tenantId, archivedAt: null },
        data: { archivedAt: new Date() },
      });
      if (result.count === 0) throw new HttpError(404, "Categoria não encontrada.");
      await recordAudit(tx, user, "sector_category.archived", "SectorCategory", categoryId);
    });
    return { ok: true };
  }

  list(user: ServerAuthUser) {
    return this.prisma.sector.findMany({
      where: { tenantId: user.tenantId, archivedAt: null },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      include: {
        category: { select: { id: true, name: true, color: true } },
        members: { include: { member: { select: { id: true, displayName: true, user: { select: { name: true } } } } } },
      },
    }).then((rows) =>
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        color: row.color,
        position: row.position,
        active: row.active,
        timezone: row.timezone,
        workingHours: row.workingHours,
        greeting: row.greeting,
        outOfHoursMessage: row.outOfHoursMessage,
        requireCloseReason: row.requireCloseReason,
        category: row.category,
        members: row.members.map((link) => ({
          id: link.member.id,
          name: link.member.displayName ?? link.member.user.name,
        })),
      })),
    );
  }

  async save(user: ServerAuthUser, body: Body, id?: string) {
    const existing = id
      ? await this.prisma.sector.findFirst({ where: { id: requireUuid(id), tenantId: user.tenantId, archivedAt: null } })
      : null;
    if (id && !existing) throw new HttpError(404, "Setor não encontrado.");
    const name = body.name !== undefined || !id ? requiredString(body, "name", 80) : existing!.name;
    const data: Prisma.SectorUncheckedUpdateInput = {
      name,
      color: color(body) ?? existing?.color ?? "#3b5bfd",
      timezone: parseTimezone(body.timezone ?? existing?.timezone),
      greeting: body.greeting !== undefined ? optionalString(body, "greeting", 500) ?? null : existing?.greeting,
      outOfHoursMessage: body.outOfHoursMessage !== undefined ? optionalString(body, "outOfHoursMessage", 500) ?? null : existing?.outOfHoursMessage,
      requireCloseReason: body.requireCloseReason === undefined ? (existing?.requireCloseReason ?? false) : body.requireCloseReason === true,
      active: body.active === undefined ? (existing?.active ?? true) : body.active === true,
      position: body.position === undefined ? (existing?.position ?? 0) : Number(body.position) || 0,
    };
    if (body.workingHours !== undefined) {
      const hours = parseWorkingHours(body.workingHours);
      data.workingHours = hours === null ? Prisma.JsonNull : (hours as Prisma.InputJsonValue);
    }
    if (body.categoryId !== undefined) {
      if (body.categoryId === null) data.categoryId = null;
      else {
        const categoryId = requireUuid(body.categoryId, "categoryId");
        const cat = await this.prisma.sectorCategory.findFirst({ where: { id: categoryId, tenantId: user.tenantId, archivedAt: null } });
        if (!cat) throw new HttpError(422, "Categoria inválida.");
        data.categoryId = categoryId;
      }
    }
    const memberIds = Array.isArray(body.memberIds) ? body.memberIds.map((value) => requireUuid(value, "memberIds")) : null;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const sector = id
          ? await tx.sector.update({ where: { id }, data })
          : await tx.sector.create({
              data: {
                tenantId: user.tenantId,
                name: String(data.name),
                color: String(data.color),
                timezone: String(data.timezone),
                greeting: (data.greeting as string | null) ?? null,
                outOfHoursMessage: (data.outOfHoursMessage as string | null) ?? null,
                requireCloseReason: Boolean(data.requireCloseReason),
                active: Boolean(data.active),
                position: Number(data.position) || 0,
                workingHours: data.workingHours as Prisma.InputJsonValue | undefined,
                categoryId: (data.categoryId as string | null | undefined) ?? null,
              },
            });
        if (memberIds) {
          const count = await tx.tenantMember.count({ where: { id: { in: memberIds }, tenantId: user.tenantId, status: "ACTIVE" } });
          if (count !== memberIds.length) throw new HttpError(422, "Participante inválido.");
          await tx.sectorMember.deleteMany({ where: { sectorId: sector.id, tenantId: user.tenantId } });
          if (memberIds.length) {
            await tx.sectorMember.createMany({
              data: memberIds.map((memberId) => ({ sectorId: sector.id, memberId, tenantId: user.tenantId })),
            });
          }
        }
        await recordAudit(tx, user, id ? "sector.updated" : "sector.created", "Sector", sector.id);
        return { id: sector.id };
      });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(409, "Já existe um setor com este nome.");
    }
  }

  async archive(user: ServerAuthUser, id: string, body: Body) {
    const sectorId = requireUuid(id);
    const open = await this.prisma.conversation.count({
      where: { tenantId: user.tenantId, sectorId, status: { in: ["OPEN", "PENDING"] } },
    });
    const reassignTo = body.reassignToSectorId ? requireUuid(body.reassignToSectorId, "reassignToSectorId") : null;
    if (open > 0 && !reassignTo) {
      throw new HttpError(409, `Há ${open} atendimento(s) neste setor. Informe reassignToSectorId.`);
    }
    if (reassignTo === sectorId) throw new HttpError(422, "O setor de destino deve ser outro.");
    await this.prisma.$transaction(async (tx) => {
      if (reassignTo) {
        const dest = await tx.sector.findFirst({ where: { id: reassignTo, tenantId: user.tenantId, archivedAt: null } });
        if (!dest) throw new HttpError(422, "Setor de destino inválido.");
        await tx.conversation.updateMany({ where: { tenantId: user.tenantId, sectorId, status: { in: ["OPEN", "PENDING"] } }, data: { sectorId: reassignTo } });
      }
      const result = await tx.sector.updateMany({
        where: { id: sectorId, tenantId: user.tenantId, archivedAt: null },
        data: { archivedAt: new Date(), active: false },
      });
      if (result.count === 0) throw new HttpError(404, "Setor não encontrado.");
      await tx.roundRobinRule.updateMany({ where: { tenantId: user.tenantId, sectorId }, data: { active: false } });
      await recordAudit(tx, user, "sector.archived", "Sector", sectorId);
    });
    return { ok: true };
  }
}

let singleton: SectorsService | null = null;
export function getSectorsService() {
  singleton ??= new SectorsService();
  return singleton;
}
