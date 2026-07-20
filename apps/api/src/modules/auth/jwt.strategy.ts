import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { resolveRequiredSecret } from "../../config/production-env";
import { AuthUser } from "./types/auth-user";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: resolveRequiredSecret(config, "JWT_ACCESS_SECRET", "dev-access-secret"),
    });
  }

  validate(payload: AuthUser): AuthUser {
    return payload;
  }
}
