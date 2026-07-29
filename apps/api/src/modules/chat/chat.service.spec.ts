import assert from "node:assert/strict";
import { NotFoundException } from "@nestjs/common";
import { describe, it } from "node:test";
import { ChatService } from "./chat.service";

describe("ChatService", () => {
  it("lists conversations capped at 50", async () => {
    let take: number | undefined;
    const service = new ChatService({
      conversation: {
        async findMany({ take: limit }: { take: number }) {
          take = limit;
          return [];
        },
      },
    } as never);

    await service.listConversations("tenant-id");
    assert.equal(take, 50);
  });

  it("throws when sending message to missing conversation", async () => {
    const service = new ChatService({
      conversation: {
        async findFirst() {
          return null;
        },
      },
    } as never);

    await assert.rejects(
      () => service.sendMessage("tenant-id", "member-id", "missing", "Olá"),
      NotFoundException,
    );
  });

  it("creates outbound message for existing conversation", async () => {
    let created: unknown;
    const service = new ChatService({
      conversation: {
        async findFirst() {
          return { id: "conversation-id" };
        },
        async update() {
          return { id: "conversation-id" };
        },
      },
      message: {
        async create({ data }: { data: Record<string, unknown> }) {
          created = data;
          return { id: "message-id", ...data };
        },
      },
    } as never);

    const message = await service.sendMessage(
      "tenant-id",
      "member-id",
      "conversation-id",
      "Olá",
    );

    assert.equal(message.body, "Olá");
    assert.equal((created as { direction: string }).direction, "OUTBOUND");
  });
});
