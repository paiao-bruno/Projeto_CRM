import { PartialType } from "@nestjs/mapped-types";
import { IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength } from "class-validator";
import { CreateSgpCredentialsDto } from "./create-sgp-credentials.dto";

export class UpdateSgpCredentialsDto extends PartialType(CreateSgpCredentialsDto) {
  @IsOptional()
  @IsIn(["DRAFT", "CONNECTING", "ACTIVE", "DEGRADED", "DISCONNECTED", "ERROR", "DISABLED"])
  status?:
    | "DRAFT"
    | "CONNECTING"
    | "ACTIVE"
    | "DEGRADED"
    | "DISCONNECTED"
    | "ERROR"
    | "DISABLED";
}

export class TestSgpCredentialsDto {
  @IsOptional()
  @IsString()
  endpoint?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  apiUrl?: string;

  @IsOptional()
  @IsString()
  apiPort?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  app?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  token?: string;

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(120000)
  timeoutMs?: number;
}
