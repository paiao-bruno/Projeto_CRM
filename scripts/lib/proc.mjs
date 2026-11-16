import { spawn, spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";

/** Encerra o processo e seus filhos (no Windows usa taskkill /T; em POSIX, o grupo do processo). */
export function killTree(child, signal = "SIGTERM") {
  if (!child || child.exitCode !== null || !child.pid) return;
  if (isWindows) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* já encerrado */
    }
  }
}

/** Inicia um processo gerenciado (npm no Windows precisa de shell). Retorna { child, exited }. */
export function spawnManaged(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: options.stdio ?? "inherit",
    env: options.env ?? process.env,
    cwd: options.cwd,
    shell: isWindows && /^(npm|npx)$/.test(command),
    detached: !isWindows,
  });
  const exited = new Promise((resolve) => {
    child.on("exit", (code, signal) => resolve({ code: code ?? (signal ? 1 : 0), signal }));
    child.on("error", (error) => resolve({ code: 1, signal: null, error }));
  });
  return { child, exited };
}

export function runStep(label, command, args, env = process.env) {
  console.log(`\n[${label}]`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env,
    shell: isWindows && /^(npm|npx)$/.test(command),
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
