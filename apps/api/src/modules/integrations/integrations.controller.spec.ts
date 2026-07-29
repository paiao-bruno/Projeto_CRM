import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IntegrationsController } from "./integrations.controller";

const user = {
  sub: "user-id",
  email: "admin@example.com",
  name: "Admin",
  tenantId: "tenant-id",
  tenantName: "Tenant",
  memberId: "member-id",
  role: "Admin",
};

function createController() {
  const calls: string[] = [];
  const service = {
    listSgpCredentials: async () => {
      calls.push("listSgpCredentials");
      return [];
    },
    getSgpCredentials: async () => {
      calls.push("getSgpCredentials");
      return {};
    },
    createSgpCredentials: async () => {
      calls.push("createSgpCredentials");
      return {};
    },
    updateSgpCredentials: async () => {
      calls.push("updateSgpCredentials");
      return {};
    },
    removeSgpCredentials: async () => {
      calls.push("removeSgpCredentials");
      return {};
    },
    testSgpCredentials: async () => {
      calls.push("testSgpCredentials");
      return {};
    },
    getSgpAutoSyncConfig: async () => {
      calls.push("getSgpAutoSyncConfig");
      return {};
    },
    updateSgpAutoSyncConfig: async () => {
      calls.push("updateSgpAutoSyncConfig");
      return {};
    },
    triggerManualAutoSync: async () => {
      calls.push("triggerManualAutoSync");
      return { status: "completed" };
    },
    testSgpAuth: async () => {
      calls.push("testSgpAuth");
      return {};
    },
    discoverSgpCustomers: async () => {
      calls.push("discoverSgpCustomers");
      return {};
    },
    debugSgp: async () => {
      calls.push("debugSgp");
      return {};
    },
    syncSgpCustomers: async () => {
      calls.push("syncSgpCustomers");
      return {};
    },
    getSgpSyncStatus: async () => {
      calls.push("getSgpSyncStatus");
      return null;
    },
    listSgpSyncRuns: async () => {
      calls.push("listSgpSyncRuns");
      return { items: [], page: 1, limit: 20, total: 0, totalPages: 0 };
    },
    getSgpSyncRun: async () => {
      calls.push("getSgpSyncRun");
      return {};
    },
  };

  return {
    controller: new IntegrationsController(service as never),
    calls,
  };
}

describe("IntegrationsController", () => {
  it("delegates all SGP integration endpoints to service", async () => {
    const { controller, calls } = createController();

    await controller.listSgpCredentials(user);
    await controller.getSgpCredentials(user, "cred-1");
    await controller.createSgpCredentials(user, {
      name: "Principal",
      apiUrl: "https://sgp.example",
      app: "app",
      token: "token",
    });
    await controller.updateSgpCredentials(user, "cred-1", { name: "Atualizado" });
    await controller.removeSgpCredentials(user, "cred-1");
    await controller.testStoredSgpCredentials(user, "cred-1", {});
    await controller.testSgpCredentials(user, { token: "token" });
    await controller.getSgpAutoSync(user);
    await controller.updateSgpAutoSync(user, { enabled: true });
    await controller.runSgpAutoSync(user);
    await controller.testSgpAuth(user, {});
    await controller.discoverSgpCustomers(user, {});
    await controller.debugSgp(user, { endpoint: "/api/test" });
    await controller.syncSgpCustomers(user, {});
    await controller.getSgpSyncStatus(user);
    await controller.listSgpSyncRuns(user, { page: 1, limit: 10 });
    await controller.getSgpSyncRun(user, "run-1");

    assert.equal(calls.length, 17);
    assert.ok(calls.includes("syncSgpCustomers"));
    assert.ok(calls.includes("listSgpSyncRuns"));
  });
});
