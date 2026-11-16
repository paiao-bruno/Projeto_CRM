/**
 * Cliente SSE baseado em fetch (o JWT vai no cabeçalho Authorization, nunca na URL).
 * Reconecta com backoff; a cada (re)conexão chama onResync para o chamador rebuscar o estado.
 * Após falhas repetidas entra em modo "polling" explícito, que o chamador deve exibir ao usuário.
 */
export type RealtimeState = "connecting" | "live" | "reconnecting" | "polling";

export type RealtimeChange = { type: string; conversationId: string | null; at: string };

export function parseSseChunk(buffer: string): { events: Array<{ event: string; data: string; id?: string }>; rest: string } {
  const events: Array<{ event: string; data: string; id?: string }> = [];
  const frames = buffer.split("\n\n");
  const rest = frames.pop() ?? "";
  for (const frame of frames) {
    let event = "message";
    let id: string | undefined;
    const data: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("id:")) id = line.slice(3).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (data.length > 0 || event !== "message") events.push({ event, data: data.join("\n"), id });
  }
  return { events, rest };
}

export function nextBackoff(attempt: number) {
  return Math.min(15_000, 1000 * 2 ** Math.max(0, attempt - 1));
}

export const POLLING_AFTER_FAILURES = 3;

export function connectRealtime(options: {
  token: string;
  onChange: (change: RealtimeChange) => void;
  onResync: () => void;
  onState: (state: RealtimeState) => void;
  fetchImpl?: typeof fetch;
}) {
  const doFetch = options.fetchImpl ?? fetch;
  let stopped = false;
  let controller: AbortController | null = null;
  let failures = 0;

  async function run() {
    while (!stopped) {
      controller = new AbortController();
      options.onState(failures >= POLLING_AFTER_FAILURES ? "polling" : failures > 0 ? "reconnecting" : "connecting");
      try {
        const response = await doFetch("/api/realtime/stream", {
          headers: { Authorization: `Bearer ${options.token}`, Accept: "text/event-stream" },
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok || !response.body) throw new Error(`status ${response.status}`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          const parsed = parseSseChunk(buffer);
          buffer = parsed.rest;
          for (const frame of parsed.events) {
            if (frame.event === "ready") {
              failures = 0;
              options.onState("live");
              options.onResync();
            } else if (frame.event === "change") {
              try {
                options.onChange(JSON.parse(frame.data) as RealtimeChange);
              } catch {
                options.onResync();
              }
            }
          }
        }
        failures += 1;
      } catch {
        if (stopped) return;
        failures += 1;
      }
      if (stopped) return;
      options.onState(failures >= POLLING_AFTER_FAILURES ? "polling" : "reconnecting");
      await new Promise((resolve) => setTimeout(resolve, nextBackoff(failures)));
    }
  }

  void run();
  return () => {
    stopped = true;
    controller?.abort();
  };
}
