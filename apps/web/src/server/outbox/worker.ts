import { OutboxService, newWorkerId } from "./service";

export type WorkerHandle = { stop: () => Promise<void>; id: string };

/** Laço do worker dedicado: reaper de leases expirados, reivindicação e processamento. */
export function startOutboxWorker(
  service: OutboxService = new OutboxService(),
  options: { intervalMs?: number; batch?: number; log?: (line: string) => void } = {},
): WorkerHandle {
  const intervalMs = options.intervalMs ?? 1000;
  const batch = options.batch ?? 10;
  const log = options.log ?? ((line: string) => console.log(line));
  const id = newWorkerId();
  let stopping = false;
  let lastBeat = 0;
  let wake: (() => void) | null = null;

  const loop = (async () => {
    log(`[outbox] ${id} iniciado`);
    while (!stopping) {
      try {
        if (Date.now() - lastBeat > 5000) {
          await service.heartbeat("outbox", { workerId: id, pid: process.pid });
          lastBeat = Date.now();
        }
        const { claimed } = await service.runOnce(batch);
        if (claimed >= batch) continue;
      } catch (error) {
        log(`[outbox] erro no ciclo: ${error instanceof Error ? error.message : "desconhecido"}`);
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, intervalMs);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
    log(`[outbox] ${id} encerrado`);
  })();

  return {
    id,
    async stop() {
      stopping = true;
      wake?.();
      await loop;
    },
  };
}
