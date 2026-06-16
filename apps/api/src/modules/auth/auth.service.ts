import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { compare } from "bcryptjs";
import { PrismaService } from "../database/prisma.service";
import { LoginDto } from "./dto/login.dto";
import { AuthUser } from "./types/auth-user";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      include: {
        memberships: {
          where: { status: "ACTIVE" },
          include: {
            tenant: true,
            role: true,
          },
          take: 1,
        },
      },
    });

    if (!user || user.status !== "ACTIVE") {
      throw new UnauthorizedException("Credenciais invalidas.");
    }

    const passwordMatches = await compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException("Credenciais invalidas.");
    }

    const membership = user.memberships[0];
    if (!membership) {
      throw new UnauthorizedException("Usuario sem empresa ativa.");
    }

    const payload: AuthUser = {
      sub: user.id,
      email: user.email,
      name: user.name,
      tenantId: membership.tenantId,
      tenantName: membership.tenant.name,
      memberId: membership.id,
      role: membership.role?.name ?? "Atendente",
    };

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return {
      accessToken: await this.jwt.signAsync(payload, {
        secret: this.config.get<string>("JWT_ACCESS_SECRET", "dev-access-secret"),
        expiresIn: "8h",
      }),
      user: payload,
    };
  }

  profile(user: AuthUser) {
    return { user };
  }
}
