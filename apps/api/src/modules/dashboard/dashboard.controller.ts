import { Controller, Get } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/types/auth-user";
import { RequirePermissions } from "../../security/decorators/require-permissions.decorator";
import { DashboardService } from "./dashboard.service";

@RequirePermissions("dashboard.read")
@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  overview(@CurrentUser() user: AuthUser) {
    return this.dashboardService.getOverview(user.tenantId);
  }
}
