import { Body, Controller, Get, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Public } from "../../security/decorators/public.decorator";
import { readSecurityConfig } from "../../security/security.config";
import { AuthService } from "./auth.service";
import { CurrentUser } from "./current-user.decorator";
import { LoginDto } from "./dto/login.dto";
import { AuthUser } from "./types/auth-user";

const authRateLimit = readSecurityConfig(process.env).authRateLimitMax;

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: authRateLimit, ttl: 60_000 } })
  @Post("login")
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get("me")
  me(@CurrentUser() user: AuthUser) {
    return this.authService.profile(user);
  }
}
