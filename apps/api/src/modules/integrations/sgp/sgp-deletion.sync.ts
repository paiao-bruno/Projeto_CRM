import { Prisma } from "@prisma/client";

export type SgpSeenExternalIds = {
  customers: Set<string>;
  contracts: Set<string>;
  invoices: Set<string>;
};

export function createSgpSeenExternalIds(): SgpSeenExternalIds {
  return {
    customers: new Set<string>(),
    contracts: new Set<string>(),
    invoices: new Set<string>(),
  };
}

export function isSgpManagedMetadata(metadata: Prisma.JsonValue | null | undefined) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }

  return (metadata as Record<string, unknown>).source === "SGP";
}

export function isSgpDeletedRecord(raw: Record<string, unknown>) {
  const deletedFlag = raw.excluido ?? raw.excluído ?? raw.deleted ?? raw.removido;
  const normalizedFlag = String(deletedFlag ?? "").trim().toLowerCase();

  if (
    deletedFlag === true ||
    deletedFlag === 1 ||
    normalizedFlag === "1" ||
    normalizedFlag === "true" ||
    normalizedFlag === "sim" ||
    normalizedFlag === "s"
  ) {
    return true;
  }

  const status = String(
    raw.status ?? raw.situacao ?? raw.situação ?? raw.situacao_cadastro ?? "",
  ).toLowerCase();

  return (
    status.includes("exclu") ||
    status.includes("delet") ||
    status.includes("remov")
  );
}

export function withSgpDeletionMetadata(
  metadata: Prisma.JsonValue | null | undefined,
  reason: string,
): Prisma.InputJsonObject {
  const base =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};

  return {
    ...base,
    source: base.source ?? "SGP",
    sgpDeletedAt: new Date().toISOString(),
    sgpDeletionReason: reason,
  };
}

export function withSgpRestoredMetadata(
  metadata: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): Prisma.InputJsonObject {
  const base =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, Prisma.InputJsonValue | null>)
      : {};

  const { sgpDeletedAt: _sgpDeletedAt, sgpDeletionReason: _sgpDeletionReason, ...rest } = base;

  return {
    ...rest,
    source: rest.source ?? "SGP",
    sgpRestoredAt: new Date().toISOString(),
  };
}
