import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthUser } from "../auth/types/auth-user";
import { InvoicesService } from "./invoices.service";

@UseGuards(JwtAuthGuard)
@Controller("invoices")
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query("customerId") customerId?: string,
    @Query("limit") limit?: string,
  ) {
    return this.invoicesService.list(user.tenantId, customerId, this.parseLimit(limit));
  }

  private parseLimit(limit?: string) {
    const parsed = Number(limit);
    if (!Number.isFinite(parsed) || parsed <= 0) return 2000;
    return Math.min(parsed, 5000);
  }
}
