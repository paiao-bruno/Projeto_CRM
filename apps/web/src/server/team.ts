import { hash } from "bcryptjs";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { ServerAuthUser } from "./auth";
import { validateNewPassword } from "./auth";
import { recordAudit } from "./audit";
import { HttpError } from "./http";
import { derivePresence } from "./inbox/rules";
import { getPrisma } from "./prisma";
import { optionalString, parsePaging, paged, requireUuid, requiredString, type Body } from "./validation";

export class TeamService {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  async list(user: ServerAuthUser, query: URLSearchParams) {
    const { page, limit } = parsePaging(query, 50, 100);
    const status = query.get("status");
    const search = query.get("search")?.trim();
    const where: Prisma.TenantMemberWhereInput = {
      tenantId: user.tenantId,
      ...(status ? { status: status as never } : {}),
      ...(search
        ? {
            OR: [
              { displayName: { contains: search, mode: "insensitive" } },
              { user: { name: { contains: search, mode: "insensitive" } } },
              { user: { email: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.tenantMember.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "asc" },
        include: {
          user: { select: { id: true, email: true, name: true, status: true } },
          role: { select: { id: true, name: true } },
          presence: true,
          sectorLinks: { include: { sector: { select: { id: true, name: true, color: true } } } },
        },
      }),
      this.prisma.tenantMember.count({ where }),
    ]);
    const now = new Date();
    return paged(
      items.map((member) => ({
        id: member.id,
        displayName: member.displayName ?? member.user.name,
        jobTitle: member.jobTitle,
        status: member.status,
        maxActiveConversations: member.maxActiveConversations,
        email: member.user.email,
        userStatus: member.user.status,
        role: member.role,
        presence: derivePresence(member.presence, now),
        lastSeenAt: member.presence?.lastSeenAt ?? member.lastSeenAt,
        sectors: member.sectorLinks.map((link) => link.sector),
      })),
      total,
      page,
      limit,
    );
  }

  async listRoles(user: ServerAuthUser) {
    return this.prisma.role.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { name: "asc" },
      include: { permissions: { include: { permission: { select: { code: true } } } } },
    }).then((roles) =>
      roles.map((role) => ({
        id: role.id,
        name: role.name,
        description: role.description,
        permissions: role.permissions.map((item) => item.permission.code),
      })),
    );
  }

  async create(user: ServerAuthUser, body: Body) {
    const email = requiredString(body, "email", 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(422, "email inválido.");
    const name = requiredString(body, "name", 120);
    const roleId = requireUuid(body.roleId, "roleId");
    const role = await this.prisma.role.findFirst({ where: { id: roleId, tenantId: user.tenantId } });
    if (!role) throw new HttpError(422, "Papel inválido.");
    const sectorIds = Array.isArray(body.sectorIds) ? body.sectorIds.map((id) => requireUuid(id, "sectorIds")) : [];
    const password = body.password !== undefined ? validateNewPassword(body.password) : null;
    const maxActive = body.maxActiveConversations === null || body.maxActiveConversations === undefined
      ? null
      : Number(body.maxActiveConversations);
    if (maxActive !== null && (!Number.isInteger(maxActive) || maxActive < 1 || maxActive > 500)) {
      throw new HttpError(422, "maxActiveConversations deve ser um inteiro entre 1 e 500.");
    }

    return this.prisma.$transaction(async (tx) => {
      let account = await tx.user.findUnique({ where: { email } });
      if (!account) {
        if (!password) throw new HttpError(422, "Senha obrigatória para nova pessoa.");
        account = await tx.user.create({
          data: { email, name, passwordHash: await hash(password, 10), status: "ACTIVE" },
        });
      } else if (account.status !== "ACTIVE") {
        throw new HttpError(409, "Este e-mail está desativado.");
      }
      const existing = await tx.tenantMember.findUnique({
        where: { tenantId_userId: { tenantId: user.tenantId, userId: account.id } },
      });
      if (existing) throw new HttpError(409, "Esta pessoa já faz parte da organização.");
      const member = await tx.tenantMember.create({
        data: {
          tenantId: user.tenantId,
          userId: account.id,
          roleId,
          displayName: optionalString(body, "displayName", 120) ?? name,
          jobTitle: optionalString(body, "jobTitle", 80) ?? null,
          status: "ACTIVE",
          maxActiveConversations: maxActive,
        },
      });
      if (sectorIds.length) {
        const sectors = await tx.sector.count({ where: { id: { in: sectorIds }, tenantId: user.tenantId, archivedAt: null } });
        if (sectors !== sectorIds.length) throw new HttpError(422, "Setor inválido.");
        await tx.sectorMember.createMany({ data: sectorIds.map((sectorId) => ({ sectorId, memberId: member.id, tenantId: user.tenantId })) });
      }
      await recordAudit(tx, user, "team.member_created", "TenantMember", member.id, { email });
      return { id: member.id };
    });
  }

  async update(user: ServerAuthUser, id: string, body: Body) {
    const member = await this.prisma.tenantMember.findFirst({
      where: { id: requireUuid(id), tenantId: user.tenantId },
    });
    if (!member) throw new HttpError(404, "Pessoa não encontrada.");
    const data: Prisma.TenantMemberUncheckedUpdateInput = {};
    if (body.displayName !== undefined) data.displayName = optionalString(body, "displayName", 120) ?? null;
    if (body.jobTitle !== undefined) data.jobTitle = optionalString(body, "jobTitle", 80) ?? null;
    if (body.roleId !== undefined) {
      const roleId = requireUuid(body.roleId, "roleId");
      const role = await this.prisma.role.findFirst({ where: { id: roleId, tenantId: user.tenantId } });
      if (!role) throw new HttpError(422, "Papel inválido.");
      data.roleId = roleId;
    }
    if (body.maxActiveConversations !== undefined) {
      if (body.maxActiveConversations === null) data.maxActiveConversations = null;
      else {
        const maxActive = Number(body.maxActiveConversations);
        if (!Number.isInteger(maxActive) || maxActive < 1 || maxActive > 500) {
          throw new HttpError(422, "maxActiveConversations deve ser um inteiro entre 1 e 500.");
        }
        data.maxActiveConversations = maxActive;
      }
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.tenantMember.update({ where: { id }, data });
      if (Array.isArray(body.sectorIds)) {
        const sectorIds = body.sectorIds.map((value) => requireUuid(value, "sectorIds"));
        const sectors = await tx.sector.count({ where: { id: { in: sectorIds }, tenantId: user.tenantId, archivedAt: null } });
        if (sectors !== sectorIds.length) throw new HttpError(422, "Setor inválido.");
        await tx.sectorMember.deleteMany({ where: { memberId: id, tenantId: user.tenantId } });
        if (sectorIds.length) {
          await tx.sectorMember.createMany({ data: sectorIds.map((sectorId) => ({ sectorId, memberId: id, tenantId: user.tenantId })) });
        }
      }
      await recordAudit(tx, user, "team.member_updated", "TenantMember", id);
      return { ok: true };
    });
  }

  /**
   * Desativa o acesso. Tickets ativos exigem reassociação explícita: não apaga o histórico
   * e não deixa conversas órfãs sem decisão.
   */
  async deactivate(user: ServerAuthUser, id: string, body: Body) {
    const memberId = requireUuid(id);
    if (memberId === user.memberId) throw new HttpError(422, "Não é possível desativar a própria sessão por esta tela.");
    const member = await this.prisma.tenantMember.findFirst({ where: { id: memberId, tenantId: user.tenantId } });
    if (!member) throw new HttpError(404, "Pessoa não encontrada.");
    const open = await this.prisma.conversation.count({
      where: { tenantId: user.tenantId, assignedMemberId: memberId, status: { in: ["OPEN", "PENDING"] } },
    });
    const reassignTo = body.reassignToMemberId ? requireUuid(body.reassignToMemberId, "reassignToMemberId") : null;
    if (open > 0 && !reassignTo) {
      throw new HttpError(409, `Há ${open} atendimento(s) ativo(s). Informe reassignToMemberId para reassociar.`);
    }
    if (reassignTo) {
      const target = await this.prisma.tenantMember.findFirst({ where: { id: reassignTo, tenantId: user.tenantId, status: "ACTIVE" } });
      if (!target) throw new HttpError(422, "Destino da reassociação inválido.");
    }
    await this.prisma.$transaction(async (tx) => {
      if (reassignTo) {
        await tx.conversation.updateMany({
          where: { tenantId: user.tenantId, assignedMemberId: memberId, status: { in: ["OPEN", "PENDING"] } },
          data: { assignedMemberId: reassignTo, claimedAt: new Date(), version: { increment: 1 } },
        });
      }
      await tx.tenantMember.update({ where: { id: memberId }, data: { status: "DISABLED" } });
      await tx.authSession.updateMany({ where: { userId: member.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.teamPresence.updateMany({ where: { memberId }, data: { isOnline: false, status: "OFFLINE" } });
      await recordAudit(tx, user, "team.member_deactivated", "TenantMember", memberId, { open, reassignTo });
    });
    return { ok: true, reassigned: open };
  }
}

let singleton: TeamService | null = null;
export function getTeamService() {
  singleton ??= new TeamService();
  return singleton;
}
