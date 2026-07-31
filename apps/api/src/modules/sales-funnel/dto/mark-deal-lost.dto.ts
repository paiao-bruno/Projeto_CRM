import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from "class-validator";
import { SALES_FUNNEL_FIELD_LIMITS } from "../../../../../../shared/sales-funnel.constants";

export class MarkDealLostDto {
  @IsString()
  @MinLength(1)
  @MaxLength(SALES_FUNNEL_FIELD_LIMITS.lossReason)
  lossReason!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}
