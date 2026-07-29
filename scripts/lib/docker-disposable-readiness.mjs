import { spawnSync } from "node:child_process";

export const DOCKER_HEALTHCHECK_INTERVAL = "1s";
export const DOCKER_HEALTHCHECK_TIMEOUT = "3s";
export const DOCKER_HEALTHCHECK_RETRIES = "30";
export const DOCKER_HEALTHCHECK_START_PERIOD = "5s";
export const DOCKER_CONTAINER_WAIT_TIMEOUT_MS = 120_000;
export const TCP_SELECT1_CONSECUTIVE = 3;
export const TCP_SELECT1_INTERVAL_MS = 500;
export const TCP_SELECT1_TIMEOUT_MS = 60_000;

export function buildDockerHealthcheckArgs(user, database) {
  return [
    "--health-cmd",
    `pg_isready -U ${user} -d ${database}`,
    "--health-interval",
    DOCKER_HEALTHCHECK_INTERVAL,
    "--health-timeout",
    DOCKER_HEALTHCHECK_TIMEOUT,
    "--health-retries",
    DOCKER_HEALTHCHECK_RETRIES,
    "--health-start-period",
    DOCKER_HEALTHCHECK_START_PERIOD,
  ];
}

export function runDockerCommand(args, options = {}) {
  return spawnSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

export function inspectContainerField(containerName, format, runDocker = runDockerCommand) {
  const proc = runDocker(["inspect", "--format", format, containerName]);
  if (proc.status !== 0) {
    return { ok: false, value: null, error: proc.stderr || proc.stdout || "inspect failed" };
  }
  return { ok: true, value: proc.stdout.trim(), error: null };
}

export function getContainerRuntimeState(containerName, runDocker = runDockerCommand) {
  const status = inspectContainerField(containerName, "{{.State.Status}}", runDocker);
  const health = inspectContainerField(containerName, "{{.State.Health.Status}}", runDocker);
  const id = inspectContainerField(containerName, "{{.Id}}", runDocker);
  const restartCount = inspectContainerField(containerName, "{{.RestartCount}}", runDocker);
  return {
    status: status.value,
    health: health.value || "none",
    id: id.value,
    restartCount: Number.parseInt(restartCount.value ?? "0", 10) || 0,
  };
}

export async function waitForContainerRunningAndHealthy(
  containerName,
  options = {},
) {
  const timeoutMs = options.timeoutMs ?? DOCKER_CONTAINER_WAIT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? 1000;
  const runDocker = options.runDocker ?? runDockerCommand;
  const logStage = options.logStage ?? ((stage, detail) => console.log(`[reencrypt-live] ${stage}: ${detail}`));
  const deadline = Date.now() + timeoutMs;
  let lastState = null;

  while (Date.now() < deadline) {
    lastState = getContainerRuntimeState(containerName, runDocker);
    const running = lastState.status === "running";
    const healthy = lastState.health === "healthy" || lastState.health === "none";

    if (running && healthy) {
      logStage("container-ready", `status=${lastState.status} health=${lastState.health}`);
      return lastState;
    }

    if (lastState.status === "exited" || lastState.status === "dead") {
      throw new Error(
        `[container-ready] container "${containerName}" parou inesperadamente (status=${lastState.status}, health=${lastState.health}).`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `[container-ready] timeout após ${timeoutMs}ms (último estado: status=${lastState?.status ?? "unknown"}, health=${lastState?.health ?? "unknown"}).`,
  );
}

export function assertContainerIdStable(containerName, expectedId, runDocker = runDockerCommand) {
  const current = inspectContainerField(containerName, "{{.Id}}", runDocker);
  if (!current.ok || !current.value) {
    throw new Error(
      `[container-id] não foi possível inspecionar "${containerName}" para validar ID estável.`,
    );
  }
  if (current.value !== expectedId) {
    throw new Error(
      `[container-id] ID mudou: esperado ${expectedId}, atual ${current.value}.`,
    );
  }
  return current.value;
}

export function assertNoContainerRestarts(
  containerName,
  baselineRestartCount = 0,
  runDocker = runDockerCommand,
) {
  const state = getContainerRuntimeState(containerName, runDocker);
  if (state.restartCount > baselineRestartCount) {
    throw new Error(
      `[container-restart] restart count aumentou: baseline=${baselineRestartCount}, atual=${state.restartCount}.`,
    );
  }
  return state.restartCount;
}

export function formatConnectionError(error) {
  if (!error) return "(nenhum)";
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

export function captureDisposableDockerDiagnostics(containerName, stage, connectionError, options = {}) {
  const runDocker = options.runDocker ?? runDockerCommand;
  const sanitize = options.sanitize ?? ((text) => String(text ?? "(vazio)"));
  const inspectProc = runDocker(["inspect", containerName]);
  const logsProc = runDocker(["logs", "--tail", "200", containerName]);
  const state = getContainerRuntimeState(containerName, runDocker);

  return {
    stage,
    connectionError: formatConnectionError(connectionError),
    stack: connectionError instanceof Error ? connectionError.stack ?? "(sem stack)" : "(sem stack)",
    container: {
      name: containerName,
      id: state.id,
      status: state.status,
      health: state.health,
      restartCount: state.restartCount,
    },
    dockerInspect: sanitize(inspectProc.stdout || inspectProc.stderr),
    dockerLogs: sanitize(`${logsProc.stdout ?? ""}${logsProc.stderr ?? ""}`),
  };
}

export function formatDiagnosticsReport(diagnostics) {
  return [
    `[reencrypt-live] falha na etapa: ${diagnostics.stage}`,
    `connectionError: ${diagnostics.connectionError}`,
    `stack: ${diagnostics.stack}`,
    `container.id: ${diagnostics.container?.id ?? "(desconhecido)"}`,
    `container.status: ${diagnostics.container?.status ?? "(desconhecido)"}`,
    `container.health: ${diagnostics.container?.health ?? "(desconhecido)"}`,
    `container.restartCount: ${diagnostics.container?.restartCount ?? "(desconhecido)"}`,
    `docker inspect (trecho): ${String(diagnostics.dockerInspect).slice(0, 2000)}`,
    `docker logs (trecho): ${String(diagnostics.dockerLogs).slice(0, 2000)}`,
  ].join("\n");
}

export async function runTcpSelectOneProbe(databaseUrl, ClientClass) {
  const probe = new ClientClass({ connectionString: databaseUrl });
  await probe.connect();
  await probe.query("SELECT 1");
  await probe.end();
}

export async function waitForTcpSelectOneStability(
  connectAndQuery,
  options = {},
) {
  const consecutiveRequired = options.consecutiveRequired ?? TCP_SELECT1_CONSECUTIVE;
  const intervalMs = options.intervalMs ?? TCP_SELECT1_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? TCP_SELECT1_TIMEOUT_MS;
  const stage = options.stage ?? "tcp-select1-stability";
  const logStage = options.logStage ?? ((detail) => console.log(`[reencrypt-live] ${stage}: ${detail}`));
  const deadline = Date.now() + timeoutMs;
  let consecutive = 0;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      await connectAndQuery();
      consecutive += 1;
      logStage(`SELECT 1 ${consecutive}/${consecutiveRequired} OK`);
      if (consecutive >= consecutiveRequired) {
        return { consecutive, lastError: null };
      }
    } catch (error) {
      consecutive = 0;
      lastError = error;
      logStage(`falha (${formatConnectionError(error)}), reiniciando contagem`);
      if (intervalMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }
  }

  throw new Error(
    `[${stage}] não obteve ${consecutiveRequired} SELECT 1 consecutivos em ${timeoutMs}ms. Último erro: ${formatConnectionError(lastError)}`,
  );
}
