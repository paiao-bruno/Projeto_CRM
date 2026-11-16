import { NextRequest } from "next/server";
import { requireAuth, requirePermission } from "@/server/auth";
import { jsonError } from "@/server/http";
import { getRealtimeHub } from "@/server/realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEEPALIVE_MS = 25_000;

/**
 * Server-Sent Events (não WebSocket). Autenticação por cabeçalho Authorization (o cliente usa fetch),
 * então nenhum JWT trafega na URL. Os eventos são sinais mínimos; o cliente rebusca os dados
 * pelas rotas autorizadas, o que também serve de ressincronização após reconexão.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    requirePermission(user, "chat.read");
    const encoder = new TextEncoder();
    let seq = 0;
    let cleanup: (() => void) | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const write = (chunk: string) => {
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            cleanup?.();
          }
        };
        write(`retry: 3000\nevent: ready\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
        const unsubscribe = getRealtimeHub().subscribe(user.tenantId, (event) => {
          seq += 1;
          write(`id: ${seq}\nevent: change\ndata: ${JSON.stringify({ type: event.type, conversationId: event.conversationId ?? null, at: event.at })}\n\n`);
        });
        const keepalive = setInterval(() => write(`: keepalive\n\n`), KEEPALIVE_MS);
        cleanup = () => {
          clearInterval(keepalive);
          unsubscribe();
          cleanup = null;
          try {
            controller.close();
          } catch {
            /* já fechado */
          }
        };
        request.signal.addEventListener("abort", () => cleanup?.(), { once: true });
      },
      cancel() {
        cleanup?.();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
