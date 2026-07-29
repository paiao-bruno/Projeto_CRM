import { IntegrationSyncStatus } from "@prisma/client";
import { Type } from "class-transformer";
import { IsEnum, IsInt, IsISO8601, IsOptional, Max, Min } from "class-validator";

export class ListSgpSyncHistoryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsEnum(IntegrationSyncStatus)
  status?: IntegrationSyncStatus;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}
