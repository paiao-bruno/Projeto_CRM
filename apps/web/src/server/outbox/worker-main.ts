import { startOutboxWorker } from "./worker";

if (!process.env.DATABASE_URL) {
  console.error("[outbox] DATABASE_URL ausente.");
  process.exit(1);
}

const handle = startOutboxWorker();
const shutdown = (signal: string) => {
  console.log(`[outbox] ${signal} recebido; finalizando após o ciclo atual`);
  void handle.stop().then(() => process.exit(0));
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
