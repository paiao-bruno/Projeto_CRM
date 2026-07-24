import { spawnSync } from "node:child_process";
import net from "node:net";
import { setTimeout as wait } from "node:timers/promises";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://crm:crm@localhost:5432/isp_crm?schema=public";
const parsedUrl = new URL(connectionString);
const dbHost = parsedUrl.hostname || "localhost";
const dbPort = Number(parsedUrl.port || 5432);

async function canConnect() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: dbHost, port: dbPort });
    socket.setTimeout(1000);
    socket.on("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
  });
}

async function main() {
  if (await canConnect()) {
    console.log("PostgreSQL is ready.");
    return;
  }

  console.log("PostgreSQL is not ready. Starting Docker services...");
  const result = spawnSync("docker", ["compose", "up", "-d", "postgres", "redis"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    console.error(
      "Could not start Docker services. Start PostgreSQL/Redis manually or run: docker compose up -d postgres redis",
    );
    process.exit(result.status ?? 1);
  }

  for (let attempt = 1; attempt <= 30; attempt += 1) {
    if (await canConnect()) {
      console.log("PostgreSQL is ready.");
      return;
    }
    await wait(1000);
  }

  console.error("PostgreSQL did not become ready in time.");
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
