import { Controller, Get, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/types/auth-user";
import { RequirePermissions } from "../../security/decorators/require-permissions.decorator";
import { ContractsService } from "./contracts.service";

@RequirePermissions("customers.manage")
@Controller("contracts")
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query("customerId") customerId?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.contractsService.list(
      user.tenantId,
      customerId,
      this.parsePage(page),
      this.parseLimit(limit),
    );
  }

  private parseLimit(limit?: string) {
    const parsed = Number(limit);
    if (!Number.isFinite(parsed) || parsed <= 0) return 100;
    return Math.min(parsed, 500);
  }

  private parsePage(page?: string) {
    const parsed = Number(page);
    if (!Number.isFinite(parsed) || parsed <= 0) return 1;
    return Math.floor(parsed);
  }
}
