/**
 * Regras puras da caixa de entrada (M03) e da presença (M01).
 * Sem acesso a banco: testáveis por unidade.
 */

export const PERMISSIONS = {
  read: "chat.read",
  reply: "chat.reply",
  transfer: "chat.transfer",
} as const;

export type InboxTab = "queue" | "mine" | "all" | "closed";

export const PRESENCE_STALE_AFTER_MS = 90_000;
export const PRESENCE_STATUSES = ["ONLINE", "AWAY", "OFFLINE"] as const;

/** Motivos de encerramento (desenho próprio). O código é persistido; o rótulo é da interface. */
export const CLOSE_REASONS = [
  { code: "resolved", label: "Resolvido" },
  { code: "no_response", label: "Sem resposta do contato" },
  { code: "spam", label: "Spam ou inválido" },
  { code: "other_channel", label: "Encaminhado para outro canal" },
  { code: "other", label: "Outro" },
] as const;
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

export type Actor = { memberId: string; permissions: string[] };

export function has(actor: Actor, permission: string) {
  return actor.permissions.includes(permission);
}

export function actorFrom(user: { memberId: string; permissions?: string[] }): Actor {
  return { memberId: user.memberId, permissions: user.permissions ?? [] };
}

/** Quem tem chat.transfer atua como supervisor e enxerga todas as conversas do tenant. */
export function isSupervisor(actor: Actor) {
  return has(actor, PERMISSIONS.transfer);
}

export type ConversationLike = {
  assignedMemberId: string | null;
  status: "OPEN" | "PENDING" | "SOLVED" | "ARCHIVED";
};

export function canView(actor: Actor, conversation: ConversationLike) {
  if (!has(actor, PERMISSIONS.read)) return false;
  if (isSupervisor(actor)) return true;
  return (
    conversation.assignedMemberId === null ||
    conversation.assignedMemberId === actor.memberId
  );
}

export function canClaim(actor: Actor, conversation: ConversationLike) {
  return (
    has(actor, PERMISSIONS.reply) &&
    conversation.assignedMemberId === null &&
    conversation.status !== "SOLVED" &&
    conversation.status !== "ARCHIVED"
  );
}

export function canReply(actor: Actor, conversation: ConversationLike) {
  if (!has(actor, PERMISSIONS.reply)) return false;
  if (conversation.status === "SOLVED" || conversation.status === "ARCHIVED") return false;
  return conversation.assignedMemberId === actor.memberId || isSupervisor(actor);
}

export function canTransfer(actor: Actor, conversation: ConversationLike) {
  if (conversation.status === "SOLVED" || conversation.status === "ARCHIVED") return false;
  if (isSupervisor(actor)) return true;
  return has(actor, PERMISSIONS.reply) && conversation.assignedMemberId === actor.memberId;
}

export function canClose(actor: Actor, conversation: ConversationLike) {
  return canReply(actor, conversation);
}

export function canReopen(actor: Actor, conversation: ConversationLike) {
  return (
    conversation.status === "SOLVED" &&
    has(actor, PERMISSIONS.reply) &&
    (isSupervisor(actor) || conversation.assignedMemberId === actor.memberId)
  );
}

export function normalizePhone(raw: string) {
  const digits = String(raw ?? "").replace(/\D+/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

export function formatProtocol(date: Date, sequence: number) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}-${String(sequence).padStart(5, "0")}`;
}

export function derivePresence(
  record: { isOnline: boolean; status: string | null; lastSeenAt: Date | null } | null,
  now: Date = new Date(),
): PresenceStatus {
  if (!record || !record.isOnline || !record.lastSeenAt) return "OFFLINE";
  if (now.getTime() - record.lastSeenAt.getTime() > PRESENCE_STALE_AFTER_MS) return "OFFLINE";
  return record.status === "AWAY" ? "AWAY" : "ONLINE";
}

export function clampLimit(value: unknown, fallback = 30, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

export function previewText(body: string | null | undefined, max = 120) {
  const text = (body ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
