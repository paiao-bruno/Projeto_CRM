import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { DealPriority } from "@prisma/client";
import { SALES_FUNNEL_FIELD_LIMITS } from "../../../shared/sales-funnel.constants";

export class CreateDealDto {
  @IsString()
  @MinLength(1)
  @MaxLength(SALES_FUNNEL_FIELD_LIMITS.title)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  stageCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(SALES_FUNNEL_FIELD_LIMITS.phone)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(SALES_FUNNEL_FIELD_LIMITS.email)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(SALES_FUNNEL_FIELD_LIMITS.clientType)
  clientType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(SALES_FUNNEL_FIELD_LIMITS.entrySource)
  entrySource?: string;

  @IsOptional()
  @IsString()
  @MaxLength(SALES_FUNNEL_FIELD_LIMITS.contactType)
  contactType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(SALES_FUNNEL_FIELD_LIMITS.city)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(SALES_FUNNEL_FIELD_LIMITS.neighborhood)
  neighborhood?: string;

  @IsOptional()
  @IsEnum(DealPriority)
  priority?: DealPriority;

  @IsOptional()
  @IsInt()
  @Min(0)
  valueCents?: number;

  @IsOptional()
  @IsUUID()
  ownerMemberId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(SALES_FUNNEL_FIELD_LIMITS.nextAction)
  nextAction?: string;

  @IsOptional()
  @IsDateString()
  nextActionAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(SALES_FUNNEL_FIELD_LIMITS.notes)
  notes?: string;
}
