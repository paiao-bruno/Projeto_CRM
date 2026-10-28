/** Cliente das rotas Next.js /api/inbox/* (mesma origem; exige o modo web-only). */

export type DeliveryStatus = "PENDING" | "PROCESSING" | "ACCEPTED" | "DELIVERED" | "READ" | "FAILED" | "UNKNOWN";

export type InboxTab = "queue" | "mine" | "all" | "closed";

export type ConversationSummary = {
  id: string;
  protocol: string | null;
  status: "OPEN" | "PENDING" | "SOLVED" | "ARCHIVED";
  version: number;
  unreadCount: number;
  lastMessageAt: string | null;
  customer: { id: string; name: string; phone: string | null } | null;
  assignee: { id: string; name: string } | null;
  lastMessage: { preview: string; direction: string; createdAt: string } | null;
};

export type InboxList = {
  tab: InboxTab;
  total: number;
  counts: { queue: number; mine: number; closed: number; all: number | null };
  items: ConversationSummary[];
};

export type ConversationDetail = {
  id: string;
  protocol: string | null;
  status: ConversationSummary["status"];
  version: number;
  unreadCount: number;
  assignee: { id: string; name: string } | null;
  customer: { id: string; name: string; phone: string | null; email: string | null } | null;
  messages: Array<{
    id: string;
    direction: "INBOUND" | "OUTBOUND" | "INTERNAL";
    body: string | null;
    metadata: Record<string, unknown> | null;
    createdAt: string;
    delivery: { status: DeliveryStatus; attempts: number; lastError: string | null } | null;
  }>;
  events: Array<{ id: string; type: string; createdAt: string; data: Record<string, unknown> | null }>;
  can: { claim: boolean; reply: boolean; transfer: boolean; close: boolean; reopen: boolean };
};

export type TeamMember = { id: string; name: string; presence: "ONLINE" | "AWAY" | "OFFLINE" };

export class InboxRequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/inbox${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    let message = response.statusText;
    try {
      message = (await response.json()).message ?? message;
    } catch {
      /* corpo vazio */
    }
    throw new InboxRequestError(message, response.status);
  }
  return response.json() as Promise<T>;
}

const post = <T>(path: string, token: string, body: unknown = {}) =>
  call<T>(path, token, { method: "POST", body: JSON.stringify(body) });

export const inboxApi = {
  list: (token: string, params: { tab: InboxTab; search?: string }) => {
    const query = new URLSearchParams({ tab: params.tab, limit: "50" });
    if (params.search) query.set("search", params.search);
    return call<InboxList>(`/conversations?${query}`, token);
  },
  detail: (token: string, id: string) => call<ConversationDetail>(`/conversations/${id}`, token),
  members: (token: string) => call<TeamMember[]>("/members", token),
  capabilities: (token: string) => call<{ demoInbound: boolean }>("/capabilities", token),
  claim: (token: string, id: string) => post<ConversationDetail>(`/conversations/${id}/claim`, token),
  transfer: (token: string, id: string, toMemberId: string, expectedVersion: number, reason?: string) =>
    post<{ stillVisible: boolean }>(`/conversations/${id}/transfer`, token, { toMemberId, expectedVersion, reason }),
  close: (token: string, id: string, expectedVersion: number, reason?: string) =>
    post<ConversationDetail>(`/conversations/${id}/close`, token, { expectedVersion, reason }),
  reopen: (token: string, id: string, expectedVersion: number) =>
    post<ConversationDetail>(`/conversations/${id}/reopen`, token, { expectedVersion }),
  reply: (token: string, id: string, body: string, internal: boolean, clientMessageId: string) =>
    post<{ id: string }>(`/conversations/${id}/messages`, token, { body, internal, clientMessageId }),
  markRead: (token: string, id: string) => post<{ ok: boolean }>(`/conversations/${id}/read`, token),
  presence: (token: string, status: "ONLINE" | "AWAY" | "OFFLINE") => post<{ status: string }>("/presence", token, { status }),
  resolveDelivery: (token: string, conversationId: string, messageId: string, action: "retry" | "mark_failed") =>
    post<{ ok: boolean }>(`/conversations/${conversationId}/messages/${messageId}/delivery`, token, { action }),
  demoInbound: (token: string, input: { contactName: string; contactPhone: string; text: string; channelId?: string }) =>
    post<{ duplicate: boolean }>("/demo-inbound", token, {
      ...input,
      providerEventId: `demo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    }),
};

/** Exibe telefones brasileiros (55 + DDD + número) de forma legível; outros formatos ficam como estão. */
export function formatPhone(raw: string | null | undefined) {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return "sem telefone";
  const match = /^55(\d{2})(9?\d{4})(\d{4})$/.exec(digits);
  return match ? `+55 ${match[1]} ${match[2]}-${match[3]}` : `+${digits}`;
}

/** Rótulo do estado de entrega de uma mensagem de saída (nenhum estado é inventado no cliente). */
export function deliveryLabel(message: ConversationDetail["messages"][number]): { text: string; tone: "ok" | "wait" | "error" | "info" } | null {
  if (message.direction !== "OUTBOUND") return null;
  if (!message.delivery) {
    return message.metadata?.delivery === "RECORDED_ONLY"
      ? { text: "Registrada (demonstração, sem canal conectado)", tone: "info" }
      : null;
  }
  switch (message.delivery.status) {
    case "PENDING": return { text: "Aguardando envio", tone: "wait" };
    case "PROCESSING": return { text: "Processando", tone: "wait" };
    case "ACCEPTED": return { text: "Aceita pelo provedor", tone: "ok" };
    case "DELIVERED": return { text: "Entregue", tone: "ok" };
    case "READ": return { text: "Lida", tone: "ok" };
    case "FAILED": return { text: "Falhou", tone: "error" };
    case "UNKNOWN": return { text: "Resultado desconhecido", tone: "error" };
  }
}
