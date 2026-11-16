import { randomBytes } from "node:crypto";
import { compare, hashSync } from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { getPrisma } from "./prisma";
import { HttpError } from "./http";
import { jwtSecretKey } from "./jwt-secret";

export type ServerAuthUser = {
  sub: string;
  /** Presente em sessões reais; testes de serviço podem omitir. */
  sid?: string;
  email: string;
  name: string;
  tenantId: string;
  tenantName: string;
  memberId: string;
  role: string;
  permissions?: string[];
};

const SESSION_HOURS = () => {
  const hours = Number(process.env.AUTH_SESSION_HOURS);
  return Number.isFinite(hours) && hours > 0 && hours <= 72 ? hours : 8;
};

// Hash de uma senha aleatória descartada: evita diferença de tempo entre "usuário inexistente" e "senha errada".
let dummyHash: string | null = null;
const getDummyHash = () => (dummyHash ??= hashSync(randomBytes(12).toString("hex"), 10));

export function validateNewPassword(password: unknown): string {
  const value = typeof password === "string" ? password : "";
  if (value.length < 10 || value.length > 128) {
    throw new HttpError(422, "A senha deve ter entre 10 e 128 caracteres.");
  }
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    throw new HttpError(422, "A senha deve conter letras e números.");
  }
  return value;
}

export async function login(email: string, password: string, meta: { ip?: string | null; userAgent?: string | null } = {}) {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({
    where: { email: String(email ?? "").trim().toLowerCase() },
    include: {
      memberships: {
        where: { status: "ACTIVE", tenant: { status: { not: "SUSPENDED" } } },
        select: { id: true },
        take: 1,
      },
    },
  });

  const passwordMatches = await compare(String(password ?? ""), user?.passwordHash ?? getDummyHash());
  if (!user || user.status !== "ACTIVE" || !passwordMatches) {
    throw new HttpError(401, "Credenciais invalidas.");
  }
  const membership = user.memberships[0];
  if (!membership) {
    throw new HttpError(401, "Usuario sem empresa ativa.");
  }

  const expiresAt = new Date(Date.now() + SESSION_HOURS() * 3_600_000);
  const session = await prisma.authSession.create({
    data: {
      userId: user.id,
      expiresAt,
      ipAddress: meta.ip?.slice(0, 64) ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    },
  });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const accessToken = await signSessionToken({ sub: user.id, sid: session.id, memberId: membership.id }, expiresAt);
  const resolved = await resolveSession(session.id, membership.id, user.id);
  return { accessToken, user: resolved };
}

async function signSessionToken(claims: { sub: string; sid: string; memberId: string }, expiresAt: Date) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(jwtSecretKey());
}

/** Identidade e permissões vêm SEMPRE do banco: desativação, troca de papel e logout valem na próxima requisição. */
async function resolveSession(sid: string, memberId: string, userId: string): Promise<ServerAuthUser> {
  const prisma = getPrisma();
  const session = await prisma.authSession.findUnique({
    where: { id: sid },
    include: { user: true },
  });
  if (!session || session.userId !== userId || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
    throw new HttpError(401, "Sessao encerrada ou expirada.");
  }
  if (session.user.status !== "ACTIVE") throw new HttpError(401, "Usuario inativo.");
  const member = await prisma.tenantMember.findFirst({
    where: { id: memberId, userId, status: "ACTIVE", tenant: { status: { not: "SUSPENDED" } } },
    include: { tenant: true, role: { include: { permissions: { include: { permission: true } } } } },
  });
  if (!member) throw new HttpError(401, "Acesso a organizacao revogado.");
  return {
    sub: session.user.id,
    sid,
    email: session.user.email,
    name: session.user.name,
    tenantId: member.tenantId,
    tenantName: member.tenant.name,
    memberId: member.id,
    role: member.role?.name ?? "Atendente",
    permissions: member.role?.permissions.map((item) => item.permission.code) ?? [],
  };
}

export async function verifyAccessToken(token: string): Promise<ServerAuthUser> {
  let claims: { sub?: string; sid?: string; memberId?: string };
  try {
    claims = (await jwtVerify(token, jwtSecretKey())).payload as typeof claims;
  } catch {
    throw new HttpError(401, "Token invalido ou expirado.");
  }
  if (!claims.sub || !claims.sid || !claims.memberId) {
    throw new HttpError(401, "Token invalido ou expirado.");
  }
  return resolveSession(claims.sid, claims.memberId, claims.sub);
}

export async function logout(user: ServerAuthUser) {
  if (user.sid) {
    await getPrisma().authSession.updateMany({
      where: { id: user.sid, userId: user.sub, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  // Encerrar a sessão tira a pessoa da distribuição, mas preserva a escolha (status) para o próximo acesso.
  await getPrisma().teamPresence.updateMany({ where: { memberId: user.memberId }, data: { isOnline: false } });
  return { ok: true };
}

export async function revokeAllSessions(userId: string) {
  const result = await getPrisma().authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export function requirePermission(user: ServerAuthUser, permission: string) {
  const granted = new Set(user.permissions ?? []);
  if (!granted.has(permission)) {
    throw new HttpError(403, "Permissao insuficiente.");
  }
}

export async function requireAuth(request: Request) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new HttpError(401, "Nao autenticado.");
  }
  return verifyAccessToken(header.slice(7));
}
