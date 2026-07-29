import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertContainerIdStable,
  assertNoContainerRestarts,
  buildDockerHealthcheckArgs,
  captureDisposableDockerDiagnostics,
  formatConnectionError,
  formatDiagnosticsReport,
  getContainerRuntimeState,
  waitForContainerRunningAndHealthy,
  waitForTcpSelectOneStability,
} from "./docker-disposable-readiness.mjs";

describe("docker-disposable-readiness", () => {
  it("buildDockerHealthcheckArgs includes pg_isready healthcheck", () => {
    const args = buildDockerHealthcheckArgs("reencrypt_test", "reencrypt_disposable_test");
    assert.match(args.join(" "), /pg_isready -U reencrypt_test -d reencrypt_disposable_test/);
    assert.ok(args.includes("--health-interval"));
    assert.ok(args.includes("--health-retries"));
  });

  it("waitForContainerRunningAndHealthy resolves when running and healthy", async () => {
    const runDocker = (args) => {
      if (args.includes("{{.State.Status}}")) {
        return { status: 0, stdout: "running\n", stderr: "" };
      }
      if (args.includes("{{.State.Health.Status}}")) {
        return { status: 0, stdout: "healthy\n", stderr: "" };
      }
      if (args.includes("{{.Id}}")) {
        return { status: 0, stdout: "sha256:stable-id\n", stderr: "" };
      }
      if (args.includes("{{.RestartCount}}")) {
        return { status: 0, stdout: "0\n", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    const state = await waitForContainerRunningAndHealthy("isp-crm-reencrypt-test", {
      timeoutMs: 200,
      intervalMs: 10,
      logStage: () => undefined,
      runDocker,
    });
    assert.equal(state.status, "running");
    assert.equal(state.health, "healthy");
  });

  it("waitForContainerRunningAndHealthy handles transient starting state", async () => {
    let calls = 0;
    const runDocker = (args) => {
      calls += 1;
      if (args.includes("{{.State.Status}}")) {
        if (calls <= 2) {
          return { status: 0, stdout: "starting\n", stderr: "" };
        }
        return { status: 0, stdout: "running\n", stderr: "" };
      }
      if (args.includes("{{.State.Health.Status}}")) {
        if (calls <= 3) {
          return { status: 0, stdout: "starting\n", stderr: "" };
        }
        return { status: 0, stdout: "healthy\n", stderr: "" };
      }
      if (args.includes("{{.Id}}")) {
        return { status: 0, stdout: "sha256:stable-id\n", stderr: "" };
      }
      if (args.includes("{{.RestartCount}}")) {
        return { status: 0, stdout: "0\n", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    const state = await waitForContainerRunningAndHealthy("isp-crm-reencrypt-test", {
      timeoutMs: 500,
      intervalMs: 20,
      logStage: () => undefined,
      runDocker,
    });
    assert.equal(state.status, "running");
    assert.equal(state.health, "healthy");
  });

  it("assertContainerIdStable rejects changed container id", () => {
    const runDocker = (args) => {
      if (args.includes("{{.Id}}")) {
        return { status: 0, stdout: "sha256:new-id\n", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };
    assert.throws(
      () => assertContainerIdStable("isp-crm-reencrypt-test", "sha256:old-id", runDocker),
      /ID mudou/,
    );
  });

  it("assertNoContainerRestarts detects restart count increase", () => {
    const runDocker = (args) => {
      if (args.includes("{{.RestartCount}}")) {
        return { status: 0, stdout: "2\n", stderr: "" };
      }
      if (args.includes("{{.State.Status}}")) {
        return { status: 0, stdout: "running\n", stderr: "" };
      }
      if (args.includes("{{.State.Health.Status}}")) {
        return { status: 0, stdout: "healthy\n", stderr: "" };
      }
      if (args.includes("{{.Id}}")) {
        return { status: 0, stdout: "sha256:id\n", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };
    assert.throws(
      () => assertNoContainerRestarts("isp-crm-reencrypt-test", 0, runDocker),
      /restart count aumentou/,
    );
  });

  it("waitForTcpSelectOneStability requires consecutive successful probes", async () => {
    let attempts = 0;
    await waitForTcpSelectOneStability(
      async () => {
        attempts += 1;
        if (attempts === 2) {
          throw new Error("Connection terminated unexpectedly");
        }
      },
      {
        consecutiveRequired: 3,
        intervalMs: 1,
        timeoutMs: 500,
        logStage: () => undefined,
      },
    );
    assert.ok(attempts >= 4);
  });

  it("waitForTcpSelectOneStability fails after connection loss exhaustion", async () => {
    await assert.rejects(
      () =>
        waitForTcpSelectOneStability(
          async () => {
            throw new Error("Connection terminated unexpectedly");
          },
          {
            consecutiveRequired: 3,
            intervalMs: 1,
            timeoutMs: 50,
            logStage: () => undefined,
          },
        ),
      /Connection terminated unexpectedly/,
    );
  });

  it("captureDisposableDockerDiagnostics includes inspect, logs and stack", () => {
    const error = new Error("Connection terminated unexpectedly");
    const diagnostics = captureDisposableDockerDiagnostics(
      "isp-crm-reencrypt-test",
      "client.connect",
      error,
      {
        runDocker: (args) => {
          if (args[0] === "inspect") {
            return { status: 0, stdout: '{"State":{"Status":"running"}}', stderr: "" };
          }
          if (args[0] === "logs") {
            return { status: 0, stdout: "postgres ready\n", stderr: "" };
          }
          if (args.includes("{{.State.Status}}")) {
            return { status: 0, stdout: "running\n", stderr: "" };
          }
          if (args.includes("{{.State.Health.Status}}")) {
            return { status: 0, stdout: "healthy\n", stderr: "" };
          }
          if (args.includes("{{.Id}}")) {
            return { status: 0, stdout: "sha256:abc\n", stderr: "" };
          }
          if (args.includes("{{.RestartCount}}")) {
            return { status: 0, stdout: "0\n", stderr: "" };
          }
          return { status: 0, stdout: "", stderr: "" };
        },
      },
    );
    assert.equal(diagnostics.stage, "client.connect");
    assert.match(diagnostics.connectionError, /Connection terminated unexpectedly/);
    assert.match(diagnostics.stack, /Error/);
    assert.match(diagnostics.dockerInspect, /running/);
    assert.match(diagnostics.dockerLogs, /postgres ready/);
    assert.equal(diagnostics.container.restartCount, 0);
  });

  it("formatDiagnosticsReport never ends with undefined", () => {
    const report = formatDiagnosticsReport({
      stage: "tcp-select1-stability",
      connectionError: formatConnectionError(new Error("Connection terminated unexpectedly")),
      stack: "Error: Connection terminated unexpectedly",
      container: { id: "sha256:abc", status: "running", health: "healthy", restartCount: 0 },
      dockerInspect: "(vazio)",
      dockerLogs: "(vazio)",
    });
    assert.doesNotMatch(report, /undefined/);
    assert.match(report, /Connection terminated unexpectedly/);
  });

  it("getContainerRuntimeState aggregates inspect fields", () => {
    const runDocker = (args) => {
      if (args.includes("{{.State.Status}}")) {
        return { status: 0, stdout: "running\n", stderr: "" };
      }
      if (args.includes("{{.State.Health.Status}}")) {
        return { status: 0, stdout: "healthy\n", stderr: "" };
      }
      if (args.includes("{{.Id}}")) {
        return { status: 0, stdout: "sha256:abc\n", stderr: "" };
      }
      if (args.includes("{{.RestartCount}}")) {
        return { status: 0, stdout: "1\n", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };
    const state = getContainerRuntimeState("isp-crm-reencrypt-test", runDocker);
    assert.equal(state.status, "running");
    assert.equal(state.health, "healthy");
    assert.equal(state.restartCount, 1);
  });
});
