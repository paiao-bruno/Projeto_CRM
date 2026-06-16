import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthUser } from "../auth/types/auth-user";
import { AiAgentsService } from "./ai-agents.service";
import { CreateAiAgentDto } from "./dto/create-ai-agent.dto";
import { UpdateAiAgentDto } from "./dto/update-ai-agent.dto";

@UseGuards(JwtAuthGuard)
@Controller("ai-agents")
export class AiAgentsController {
  constructor(private readonly aiAgentsService: AiAgentsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.aiAgentsService.list(user.tenantId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAiAgentDto) {
    return this.aiAgentsService.create(user.tenantId, dto);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: UpdateAiAgentDto,
  ) {
    return this.aiAgentsService.update(user.tenantId, id, dto);
  }

  @Patch(":id/toggle")
  toggle(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.aiAgentsService.toggle(user.tenantId, id);
  }

  @Delete(":id")
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.aiAgentsService.remove(user.tenantId, id);
  }
}
