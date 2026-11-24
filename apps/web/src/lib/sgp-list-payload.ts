function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asText(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

/** HTTP 200 com erro de negócio não é listagem autenticada. */
export function assertSgpClientesPayload(body: unknown) {
  const root = asRecord(body);
  if (!root) throw new Error("invalid_payload");
  const businessError =
    asText(root.erro) ?? asText(root.error) ?? asText(root.mensagem) ?? asText(root.message) ?? asText(root.msg);
  const success = root.success ?? root.ok ?? root.status;
  const failedFlag = success === false || success === "erro" || success === "error";
  const hasList = Array.isArray(root.clientes) || Array.isArray(root.data) || Array.isArray(body);
  const hasPagination = Boolean(asRecord(root.paginacao));
  if (!hasList && !hasPagination) {
    const folded = (businessError ?? "erro").toLowerCase();
    if (failedFlag || /auth|token|app|unauthor|negad|inválid|inval/.test(folded)) throw new Error("auth_payload");
    throw new Error("invalid_payload");
  }
}
