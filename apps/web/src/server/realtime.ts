import { Client } from "pg";
import type { Prisma } from "@prisma/client";

export const REALTIME_CHANNEL = "vertice_events";

export type RealtimeEvent = {
  type: string;
  tenantId: string;
  conversationId?: string;
  at: string;
};

/**
 * Publica dentro da transação: o PostgreSQL só entrega NOTIFY após o COMMIT.
 * Assim nenhum evento é emitido para dados que depois sofreram rollback.
 */
export async function publishEvent(
  tx: Prisma.TransactionClient,
  event: Omit<RealtimeEvent, "at">,
) {
  const payload = JSON.stringify({ ...event, at: new Date().toISOString() });
  await tx.$executeRaw`SELECT pg_notify(${REALTIME_CHANNEL}, ${payload})`;
}

type Listener = (event: RealtimeEvent) => void;

/** Uma conexão LISTEN por processo; distribui eventos aos assinantes SSE da mesma organização. */
class RealtimeHub {
  private client: Client | null = null;
  private listeners = new Set<{ tenantId: string; send: Listener }>();
  private connecting: Promise<void> | null = null;
  private retryTimer: NodeJS.Timeout | null = null;

  subscribe(tenantId: string, send: Listener) {
    const entry = { tenantId, send };
    this.listeners.add(entry);
    void this.ensureConnected();
    return () => {
      this.listeners.delete(entry);
      if (this.listeners.size === 0) void this.close();
    };
  }

  private async ensureConnected() {
    if (this.client || this.connecting) return this.connecting ?? undefined;
    this.connecting = (async () => {
      const url = process.env.DATABASE_URL;
      if (!url) return;
      const client = new Client({ connectionString: url });
      client.on("notification", (message) => {
        if (message.channel !== REALTIME_CHANNEL || !message.payload) return;
        let event: RealtimeEvent;
        try {
          event = JSON.parse(message.payload) as RealtimeEvent;
        } catch {
          return;
        }
        for (const entry of this.listeners) {
          if (entry.tenantId === event.tenantId) entry.send(event);
        }
      });
      const reconnect = () => {
        this.client = null;
        if (this.listeners.size > 0 && !this.retryTimer) {
          this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            void this.ensureConnected();
          }, 2000);
        }
      };
      client.on("error", reconnect);
      client.on("end", reconnect);
      try {
        await client.connect();
        await client.query(`LISTEN ${REALTIME_CHANNEL}`);
        this.client = client;
      } catch {
        client.removeAllListeners();
        void client.end().catch(() => undefined);
        reconnect();
      }
    })().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async close() {
    const client = this.client;
    this.client = null;
    if (client) await client.end().catch(() => undefined);
  }
}

const globalForHub = globalThis as unknown as { __verticeRealtimeHub?: RealtimeHub };
export function getRealtimeHub() {
  globalForHub.__verticeRealtimeHub ??= new RealtimeHub();
  return globalForHub.__verticeRealtimeHub;
}
