import { IsEmail, IsIn, IsOptional, IsString } from "class-validator";

export class CreateCustomerDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  document?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsIn(["ACTIVE", "INACTIVE", "OVERDUE", "CHURNED", "PROSPECT"])
  status?: "ACTIVE" | "INACTIVE" | "OVERDUE" | "CHURNED" | "PROSPECT";

  @IsOptional()
  @IsString()
  planName?: string;
}
