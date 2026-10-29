import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { POLLING_AFTER_FAILURES, connectRealtime, nextBackoff, parseSseChunk, type RealtimeState } from "./realtime-client";

describe("realtime-client", () => {
  it("interpreta quadros SSE, ignora comentários e mantém o resto incompleto", () => {
    const parsed = parseSseChunk(': keepalive\n\nevent: ready\ndata: {"a":1}\n\nid: 7\nevent: change\ndata: {"type":"x"}\n\nevent: cha');
    assert.deepEqual(parsed.events, [
      { event: "ready", data: '{"a":1}', id: undefined },
      { event: "change", data: '{"type":"x"}', id: "7" },
    ]);
    assert.equal(parsed.rest, "event: cha");
  });

  it("backoff exponencial limitado", () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6].map(nextBackoff), [1000, 2000, 4000, 8000, 15000, 15000]);
  });

  it("envia o JWT só no cabeçalho, ressincroniza ao conectar e propaga mudanças", async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    const states: RealtimeState[] = [];
    const changes: string[] = [];
    let resyncs = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode('event: ready\ndata: {}\n\nevent: change\r\ndata: {"type":"message.received","conversationId":"c1","at":"t"}\r\n\r\n'));
      },
    });
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), auth: new Headers(init?.headers).get("authorization") });
      return new Response(body, { status: 200 });
    }) as typeof fetch;
    const stop = connectRealtime({ token: "TOKEN-SECRETO", fetchImpl, onChange: (c) => changes.push(c.type), onResync: () => (resyncs += 1), onState: (s) => states.push(s) });
    await new Promise((r) => setTimeout(r, 50));
    stop();
    assert.equal(calls[0].url, "/api/realtime/stream");
    assert.ok(!calls[0].url.includes("TOKEN"));
    assert.equal(calls[0].auth, "Bearer TOKEN-SECRETO");
    assert.equal(resyncs, 1);
    assert.deepEqual(changes, ["message.received"]);
    assert.ok(states.includes("live"));
  });

  it("após falhas repetidas entra em modo polling explícito", async () => {
    const states: RealtimeState[] = [];
    const fetchImpl = (async () => new Response("erro", { status: 503 })) as typeof fetch;
    const realSetTimeout = globalThis.setTimeout;
    (globalThis as { setTimeout: unknown }).setTimeout = ((fn: () => void) => realSetTimeout(fn, 0)) as typeof setTimeout;
    const stop = connectRealtime({ token: "t", fetchImpl, onChange: () => undefined, onResync: () => undefined, onState: (s) => states.push(s) });
    await new Promise((r) => realSetTimeout(r, 100));
    stop();
    globalThis.setTimeout = realSetTimeout;
    assert.ok(POLLING_AFTER_FAILURES >= 1);
    assert.ok(states.includes("polling"));
  });
});
