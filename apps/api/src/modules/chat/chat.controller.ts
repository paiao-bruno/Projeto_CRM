import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthUser } from "../auth/types/auth-user";
import { RequirePermissions } from "../../security/decorators/require-permissions.decorator";
import { ChatService } from "./chat.service";
import { SendMessageDto } from "./dto/send-message.dto";

@RequirePermissions("chat.read")
@Controller("chat")
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get("conversations")
  list(@CurrentUser() user: AuthUser) {
    return this.chatService.listConversations(user.tenantId);
  }

  @Get("conversations/:id")
  get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.chatService.getConversation(user.tenantId, id);
  }

  @RequirePermissions("chat.reply")
  @Post("conversations/:id/messages")
  send(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.chatService.sendMessage(user.tenantId, user.memberId, id, dto.body);
  }
}
