import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class UpdateSgpAutoSyncDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  cron?: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(1440)
  intervalMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  retryAttempts?: number;

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(3600000)
  retryDelayMs?: number;

  @IsOptional()
  @IsInt()
  @Min(30000)
  @Max(7200000)
  timeoutMs?: number;
}
