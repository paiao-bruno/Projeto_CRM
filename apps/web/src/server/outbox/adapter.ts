/**
 * Contrato de adaptador de canal. Todo envio recebe uma chave de idempotência estável (id da mensagem).
 *
 * Resultados:
 *  - accepted: o provedor aceitou a mensagem (ainda não significa entregue).
 *  - rejected: o provedor recusou DEFINITIVAMENTE antes de aceitar; `retryable` indica se vale tentar de novo.
 *  - qualquer exceção/timeout: resultado desconhecido (a mensagem pode ter sido aceita). Não há reenvio cego.
 */
export type SendRequest = {
  idempotencyKey: string;
  deliveryId: string;
  tenantId: string;
  conversationId: string;
  to: { phone: string | null; name: string | null };
  text: string;
};

export type SendResult =
  | { kind: "accepted"; providerMessageId: string }
  | { kind: "rejected"; retryable: boolean; reason: string };

export type ChannelAdapter = {
  readonly kind: string;
  /** Verdadeiro quando o provedor deduplica por idempotencyKey, tornando reenvio após resultado desconhecido seguro. */
  readonly idempotentByKey: boolean;
  send(request: SendRequest, config: Record<string, unknown>, signal: AbortSignal): Promise<SendResult>;
};

export class AdapterTimeoutError extends Error {
  constructor(message = "Tempo esgotado aguardando o provedor.") {
    super(message);
  }
}

export type TestBehavior = "accept" | "reject_retryable" | "reject_permanent" | "timeout" | "throw";

/**
 * Adaptador de teste: nunca contacta rede externa. O comportamento vem da configuração da conexão
 * (`behavior`) e permite exercitar aceite, recusa e resultado desconhecido.
 */
export const testAdapter: ChannelAdapter = {
  kind: "test",
  idempotentByKey: false,
  async send(request, config) {
    const behavior = (config.behavior as TestBehavior | undefined) ?? "accept";
    switch (behavior) {
      case "accept":
        return { kind: "accepted", providerMessageId: `test-${request.idempotencyKey}` };
      case "reject_retryable":
        return { kind: "rejected", retryable: true, reason: "Recusa temporária simulada." };
      case "reject_permanent":
        return { kind: "rejected", retryable: false, reason: "Recusa definitiva simulada." };
      case "timeout":
        throw new AdapterTimeoutError();
      default:
        throw new Error("Falha simulada do adaptador.");
    }
  },
};

const registry = new Map<string, ChannelAdapter>([[testAdapter.kind, testAdapter]]);

export function registerAdapter(adapter: ChannelAdapter) {
  registry.set(adapter.kind, adapter);
}

export function getAdapter(kind: string): ChannelAdapter | null {
  return registry.get(kind) ?? null;
}

export const SUPPORTED_ADAPTERS = ["test"] as const;
