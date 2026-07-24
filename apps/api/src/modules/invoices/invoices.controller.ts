import { Controller, Get, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/types/auth-user";
import { RequirePermissions } from "../../security/decorators/require-permissions.decorator";
import { InvoicesService } from "./invoices.service";

@RequirePermissions("customers.manage")
@Controller("invoices")
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query("customerId") customerId?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.invoicesService.list(
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
