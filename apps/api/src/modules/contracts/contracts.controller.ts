import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthUser } from "../auth/types/auth-user";
import { ContractsService } from "./contracts.service";

@UseGuards(JwtAuthGuard)
@Controller("contracts")
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query("customerId") customerId?: string,
    @Query("limit") limit?: string,
  ) {
    return this.contractsService.list(user.tenantId, customerId, this.parseLimit(limit));
  }

  private parseLimit(limit?: string) {
    const parsed = Number(limit);
    if (!Number.isFinite(parsed) || parsed <= 0) return 2000;
    return Math.min(parsed, 5000);
  }
}
