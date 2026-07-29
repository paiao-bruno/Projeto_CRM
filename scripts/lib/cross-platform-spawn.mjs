import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function resolveNpmCliPath(rootDir = process.cwd()) {
  const candidates = [];

  if (process.env.npm_execpath) {
    candidates.push(process.env.npm_execpath);
  }

  candidates.push(path.join(rootDir, "node_modules", "npm", "bin", "npm-cli.js"));
  candidates.push(
    path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  );
  candidates.push(
    path.join(path.dirname(process.execPath), "..", "node_modules", "npm", "bin", "npm-cli.js"),
  );
  candidates.push(
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  );

  const npmFromPath = resolveNpmCliPathFromPath();
  if (npmFromPath) {
    candidates.push(npmFromPath);
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  throw new Error(
    "npm-cli.js não encontrado. Instale npm ou execute via `npm run` para definir npm_execpath.",
  );
}

export function resolveNpmCliPathFromPath() {
  const lookupCommand = process.platform === "win32" ? "where" : "which";
  const lookup = spawnSync(lookupCommand, ["npm"], {
    encoding: "utf8",
    shell: false,
  });
  if (lookup.status !== 0 || !lookup.stdout.trim()) {
    return null;
  }

  const npmBin = lookup.stdout.trim().split(/\r?\n/)[0].trim();
  const npmDir = path.dirname(npmBin);
  const candidates = [
    path.join(npmDir, "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(npmDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(npmDir, "..", "node_modules", "npm", "bin", "npm-cli.js"),
  ];

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  return null;
}

export function resolveNodeInvocation(scriptPath, scriptArgs = []) {
  return {
    command: process.execPath,
    args: [scriptPath, ...scriptArgs],
    shell: false,
  };
}

export function resolveNpmInvocation(npmArgs, rootDir = process.cwd()) {
  const npmCli = resolveNpmCliPath(rootDir);
  return {
    command: process.execPath,
    args: [npmCli, ...npmArgs],
    shell: false,
  };
}

export function sanitizeSpawnEnv(env = process.env) {
  return { ...env };
}

export function sanitizeSpawnOutput(text, secrets = []) {
  if (text === undefined || text === null || text === "") {
    return "(vazio)";
  }
  let output = String(text);
  for (const secret of secrets) {
    if (secret) {
      output = output.replaceAll(secret, "***");
    }
  }
  return output.replace(/:\/\/([^:@/]+):([^@/]+)@/g, "://$1:***@");
}

export function formatSpawnFailure(stage, invocation, result) {
  return [
    `[${stage}] subprocesso falhou`,
    `command: ${invocation.command}`,
    `args: ${(invocation.args ?? []).join(" ")}`,
    `cwd: ${invocation.cwd ?? process.cwd()}`,
    `exitCode: ${result.status ?? "null"}`,
    `signal: ${result.signal ?? "null"}`,
    `error.message: ${result.error?.message ?? "(nenhum)"}`,
    `stdout: ${sanitizeSpawnOutput(result.stdout)}`,
    `stderr: ${sanitizeSpawnOutput(result.stderr)}`,
  ].join("\n");
}

export function runSubprocessSync(stage, invocation, options = {}) {
  const timeoutMs = options.timeoutMs ?? 0;
  const proc = spawnSync(invocation.command, invocation.args ?? [], {
    cwd: options.cwd ?? invocation.cwd ?? process.cwd(),
    env: sanitizeSpawnEnv(options.env ?? invocation.env ?? process.env),
    encoding: "utf8",
    shell: invocation.shell ?? false,
    stdio: options.stdio ?? ["pipe", "pipe", "pipe"],
    maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
    timeout: timeoutMs > 0 ? timeoutMs : undefined,
  });

  if (proc.error || proc.status !== 0) {
    throw new Error(formatSpawnFailure(stage, invocation, proc));
  }

  return proc;
}

export function runSubprocessAsync(stage, invocation, options = {}) {
  return new Promise((resolve, reject) => {
    const secrets = options.secrets ?? [];
    const child = spawn(invocation.command, invocation.args ?? [], {
      cwd: invocation.cwd ?? process.cwd(),
      env: sanitizeSpawnEnv(invocation.env ?? process.env),
      shell: invocation.shell ?? false,
      stdio: options.stdio ?? "inherit",
    });

    let stdout = "";
    let stderr = "";
    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
    }

    let timeoutHandle;
    if (options.timeoutMs && options.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`[${stage}] timeout após ${options.timeoutMs}ms`));
      }, options.timeoutMs);
    }

    child.on("error", (error) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      reject(
        new Error(
          formatSpawnFailure(stage, invocation, {
            status: null,
            signal: null,
            error,
            stdout: sanitizeSpawnOutput(stdout, secrets),
            stderr: sanitizeSpawnOutput(stderr, secrets),
          }),
        ),
      );
    });

    child.on("close", (status, signal) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (status === 0) {
        resolve({ status, signal, stdout, stderr });
        return;
      }
      reject(
        new Error(
          formatSpawnFailure(stage, invocation, {
            status,
            signal,
            stdout: sanitizeSpawnOutput(stdout, secrets),
            stderr: sanitizeSpawnOutput(stderr, secrets),
          }),
        ),
      );
    });
  });
}
