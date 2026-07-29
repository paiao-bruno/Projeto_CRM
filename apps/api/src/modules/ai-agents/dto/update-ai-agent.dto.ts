import { PartialType } from "@nestjs/mapped-types";
import { CreateAiAgentDto } from "./create-ai-agent.dto";

export class UpdateAiAgentDto extends PartialType(CreateAiAgentDto) {}
