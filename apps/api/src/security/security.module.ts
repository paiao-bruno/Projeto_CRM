import { Global, Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { JwtAuthGuard } from "../modules/auth/jwt-auth.guard";
import { HttpExceptionFilter } from "./filters/http-exception.filter";
import { PermissionsGuard } from "./guards/permissions.guard";
import { RedactLogsInterceptor } from "./interceptors/redact-logs.interceptor";
import { SanitizeRequestInterceptor } from "./interceptors/sanitize-request.interceptor";

@Global()
@Module({
  providers: [
    PermissionsGuard,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: SanitizeRequestInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RedactLogsInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
  ],
  exports: [PermissionsGuard],
})
export class SecurityModule {}
