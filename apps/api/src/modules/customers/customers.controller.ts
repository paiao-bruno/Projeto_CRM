import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/types/auth-user";
import { RequirePermissions } from "../../security/decorators/require-permissions.decorator";
import { CustomersService } from "./customers.service";
import { CreateCustomerDto } from "./dto/create-customer.dto";
import { UpdateCustomerDto } from "./dto/update-customer.dto";

@RequirePermissions("customers.manage")
@Controller("customers")
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query("search") search?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.customersService.list(
      user.tenantId,
      search,
      this.parsePage(page),
      this.parseLimit(limit),
    );
  }

  @Get(":id")
  get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.customersService.get(user.tenantId, id);
  }

  @Get(":id/contracts")
  listContracts(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.customersService.listContracts(user.tenantId, id);
  }

  @Get(":id/invoices")
  listInvoices(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.customersService.listInvoices(user.tenantId, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCustomerDto) {
    return this.customersService.create(user.tenantId, user.memberId, dto);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customersService.update(user.tenantId, id, dto);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.customersService.remove(user.tenantId, id);
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
