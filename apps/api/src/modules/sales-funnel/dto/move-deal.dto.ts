import { IsInt, IsOptional, IsUUID, Min } from "class-validator";

export class MoveDealDto {
  @IsUUID()
  stageId!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  @IsInt()
  @Min(1)
  version!: number;
}
