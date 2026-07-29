import { spawn } from "node:child_process";

const commands = [
  { name: "api", args: ["run", "dev", "-w", "apps/api"] },
  { name: "web", args: ["run", "dev", "-w", "apps/web"] },
];

const children = commands.map(({ name, args }) => {
  const child = spawn("npm", args, {
    stdio: ["inherit", "pipe", "pipe"],
    shell: process.platform === "win32",
    env: process.env,
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[${name}] ${chunk}`);
  });

  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[${name}] ${chunk}`);
  });

  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
      shutdown(code);
    }
  });

  return child;
});

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
