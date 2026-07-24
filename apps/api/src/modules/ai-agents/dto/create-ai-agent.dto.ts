import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Max, Min } from "class-validator";

export class CreateAiAgentDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsIn(["OPENAI", "CLAUDE", "GEMINI"])
  provider!: "OPENAI" | "CLAUDE" | "GEMINI";

  @IsString()
  model!: string;

  @IsString()
  systemPrompt!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @IsOptional()
  @IsNumber()
  maxTokens?: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
