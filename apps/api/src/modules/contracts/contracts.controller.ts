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
  list(@CurrentUser() user: AuthUser, @Query("customerId") customerId?: string) {
    return this.contractsService.list(user.tenantId, customerId);
  }
}
