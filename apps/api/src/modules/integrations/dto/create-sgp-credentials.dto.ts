import { IsInt, IsOptional, IsString, IsUrl, Max, Min, MinLength } from "class-validator";

export class CreateSgpCredentialsDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsUrl({ require_tld: false })
  apiUrl!: string;

  @IsOptional()
  @IsString()
  apiPort?: string;

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(120000)
  timeoutMs?: number;

  @IsString()
  @MinLength(1)
  app!: string;

  @IsString()
  @MinLength(1)
  token!: string;
}
