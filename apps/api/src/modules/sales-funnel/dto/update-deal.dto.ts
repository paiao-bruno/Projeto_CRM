import { PartialType } from "@nestjs/mapped-types";
import { IsInt, IsOptional, Min } from "class-validator";
import { CreateDealDto } from "./create-deal.dto";

export class UpdateDealDto extends PartialType(CreateDealDto) {
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}
