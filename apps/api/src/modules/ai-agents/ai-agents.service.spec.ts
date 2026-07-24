import assert from "node:assert/strict";
import { NotFoundException } from "@nestjs/common";
import { describe, it } from "node:test";
import { AiAgentsService } from "./ai-agents.service";

describe("AiAgentsService", () => {
  it("lists agents for tenant", async () => {
    const service = new AiAgentsService({
      aiAgent: {
        async findMany({ where }: { where: { tenantId: string } }) {
          return [{ id: "a1", tenantId: where.tenantId, status: "ACTIVE" }];
        },
      },
    } as never);

    const agents = await service.list("tenant-id");
    assert.equal(agents.length, 1);
  });

  it("toggles agent status", async () => {
    let updatedStatus: string | undefined;
    const service = new AiAgentsService({
      aiAgent: {
        async findFirst() {
          return { id: "a1", tenantId: "tenant-id", status: "ACTIVE" };
        },
        async update({ data }: { data: { status: string } }) {
          updatedStatus = data.status;
          return { id: "a1", status: data.status };
        },
      },
    } as never);

    const toggled = await service.toggle("tenant-id", "a1");
    assert.equal(updatedStatus, "INACTIVE");
    assert.equal(toggled.status, "INACTIVE");
  });

  it("throws when agent is not found", async () => {
    const service = new AiAgentsService({
      aiAgent: {
        async findFirst() {
          return null;
        },
      },
    } as never);

    await assert.rejects(
      () => service.get("tenant-id", "missing"),
      NotFoundException,
    );
  });
});
