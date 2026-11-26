import { SGP_CHURN_WORKER_TICK_MS } from "../../lib/sgp-churn-lifecycle";
import { tickSgpChurn } from "../dashboard-churn";
import { startOutboxWorker } from "./worker";

if (!process.env.DATABASE_URL) {
  console.error("[outbox] DATABASE_URL ausente.");
  process.exit(1);
}

const handle = startOutboxWorker(undefined, {
  extraTick: () => tickSgpChurn(),
  extraEveryMs: SGP_CHURN_WORKER_TICK_MS,
});
const shutdown = (signal: string) => {
  console.log(`[outbox] ${signal} recebido; finalizando após o ciclo atual`);
  void handle.stop().then(() => process.exit(0));
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
