import { compare } from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { getPrisma } from "./prisma";
import { HttpError } from "./http";

export type ServerAuthUser = {
  sub: string;
  email: string;
  name: string;
  tenantId: string;
  tenantName: string;
  memberId: string;
  role: string;
  permissions?: string[];
};

function jwtSecret() {
  return new TextEncoder().encode(
    process.env.JWT_ACCESS_SECRET ?? "dev-access-secret-min-32-chars-long",
  );
}

export async function login(email: string, password: string) {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: {
      memberships: {
        where: { status: "ACTIVE" },
        include: {
          tenant: true,
          role: {
            include: {
              permissions: { include: { permission: true } },
            },
          },
        },
        take: 1,
      },
    },
  });

  if (!user || user.status !== "ACTIVE") {
    throw new HttpError(401, "Credenciais invalidas.");
  }

  const passwordMatches = await compare(password, user.passwordHash);
  if (!passwordMatches) {
    throw new HttpError(401, "Credenciais invalidas.");
  }

  const membership = user.memberships[0];
  if (!membership) {
    throw new HttpError(401, "Usuario sem empresa ativa.");
  }

  const payload: ServerAuthUser = {
    sub: user.id,
    email: user.email,
    name: user.name,
    tenantId: membership.tenantId,
    tenantName: membership.tenant.name,
    memberId: membership.id,
    role: membership.role?.name ?? "Atendente",
    permissions: membership.role?.permissions.map((item) => item.permission.code) ?? [],
  };

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const accessToken = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("8h")
    .sign(jwtSecret());

  return { accessToken, user: payload };
}

export async function verifyAccessToken(token: string): Promise<ServerAuthUser> {
  try {
    const verified = await jwtVerify(token, jwtSecret());
    return verified.payload as ServerAuthUser;
  } catch {
    throw new HttpError(401, "Token invalido ou expirado.");
  }
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
