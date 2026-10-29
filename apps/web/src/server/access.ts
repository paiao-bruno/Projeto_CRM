import { createHash, randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import { HttpError } from "./http";
import { getPrisma } from "./prisma";
import { validateNewPassword } from "./auth";

const RESET_TTL_MS = 60 * 60 * 1000;
const MAX_RESETS_PER_HOUR = 3;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Contrato de entrega do link de recuperação. Não há provedor de e-mail configurado por padrão:
 * sem um entregador, a recuperação autoatendida não entrega nada (resposta continua genérica) e o
 * caminho utilizável é o link emitido por um administrador (`issueResetLink`).
 */
export type ResetLinkDelivery = (input: { email: string; token: string; expiresAt: Date }) => Promise<void>;

let delivery: ResetLinkDelivery | null = null;
export function setResetLinkDelivery(next: ResetLinkDelivery | null) {
  delivery = next;
}

export class AccessService {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  private async createToken(userId: string, issuedByMemberId: string | null) {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + RESET_TTL_MS);
    await this.prisma.passwordResetToken.create({
      data: { userId, tokenHash: hashToken(token), expiresAt, issuedByMemberId },
    });
    return { token, expiresAt };
  }

  /** Autoatendimento: resposta sempre igual (não revela se o e-mail existe). */
  async requestReset(email: unknown) {
    const normalized = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (normalized) {
      const user = await this.prisma.user.findUnique({
        where: { email: normalized },
        include: { memberships: { where: { status: "ACTIVE" }, select: { tenantId: true, id: true }, take: 1 } },
      });
      if (user && user.status === "ACTIVE" && user.memberships[0]) {
        const recent = await this.prisma.passwordResetToken.count({
          where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 3_600_000) } },
        });
        if (recent < MAX_RESETS_PER_HOUR) {
          const { token, expiresAt } = await this.createToken(user.id, null);
          await this.prisma.auditLog.create({
            data: { tenantId: user.memberships[0].tenantId, actorMemberId: null, action: "auth.reset_requested", entityType: "User", entityId: user.id },
          });
          if (delivery) await delivery({ email: user.email, token, expiresAt }).catch((error) => console.error("entrega de link de recuperacao falhou", error?.message));
        }
      }
    }
    return { ok: true, message: "Se o e-mail estiver cadastrado, as instruções de recuperação serão enviadas." };
  }

  /** Administrador emite um link de uso único para uma pessoa da própria organização. */
  async issueResetLink(admin: { tenantId: string; memberId: string }, memberId: string) {
    const member = await this.prisma.tenantMember.findFirst({
      where: { id: memberId, tenantId: admin.tenantId, status: "ACTIVE" },
      select: { userId: true },
    });
    if (!member) throw new HttpError(404, "Pessoa nao encontrada.");
    const { token, expiresAt } = await this.createToken(member.userId, admin.memberId);
    await this.prisma.auditLog.create({
      data: { tenantId: admin.tenantId, actorMemberId: admin.memberId, action: "auth.reset_issued", entityType: "TenantMember", entityId: memberId },
    });
    return { token, expiresAt, path: `/reset-password?token=${token}` };
  }

  async resetPassword(token: unknown, newPassword: unknown) {
    const password = validateNewPassword(newPassword);
    if (typeof token !== "string" || token.length < 20) throw new HttpError(400, "Link invalido ou expirado.");
    const passwordHash = await hash(password, 10);
    const tokenHash = hashToken(token);
    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) throw new HttpError(400, "Link invalido ou expirado.");
      const record = await tx.passwordResetToken.findUniqueOrThrow({ where: { tokenHash } });
      const user = await tx.user.findUniqueOrThrow({
        where: { id: record.userId },
        include: { memberships: { where: { status: "ACTIVE" }, select: { tenantId: true }, take: 1 } },
      });
      if (user.status !== "ACTIVE") throw new HttpError(400, "Link invalido ou expirado.");
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
      await tx.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      if (user.memberships[0]) {
        await tx.auditLog.create({
          data: { tenantId: user.memberships[0].tenantId, actorMemberId: record.issuedByMemberId, action: "auth.password_reset", entityType: "User", entityId: user.id },
        });
      }
      return { ok: true };
    });
    return result;
  }
}

let singleton: AccessService | null = null;
export function getAccessService() {
  singleton ??= new AccessService();
  return singleton;
}
