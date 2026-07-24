import { createHash } from "node:crypto";
import { CustomerStatus, Prisma } from "@prisma/client";
import { ExternalCustomerInput } from "../../customers/customers.service";

export type SgpSyncMode = "incremental" | "full";

export type SgpSyncState = {
  lastSuccessfulSyncAt?: string;
  lastSyncMode?: SgpSyncMode;
  lastSyncRunId?: string;
};

export type SgpIncrementalContext = {
  mode: SgpSyncMode;
  since: Date | null;
  sgpFilters: Record<string, unknown>;
};

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${key}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }

  return String(value);
}

export function hashContent(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function readSgpContentHash(metadata: Prisma.JsonValue | null | undefined) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }

  const hash = (metadata as Record<string, unknown>).sgpContentHash;
  return typeof hash === "string" ? hash : undefined;
}

export function withSgpContentHash(
  metadata: Prisma.InputJsonValue | undefined,
  contentHash: string,
): Prisma.InputJsonValue {
  const base =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};

  return {
    ...base,
    source: base.source ?? "SGP",
    importedAt: new Date().toISOString(),
    sgpContentHash: contentHash,
  };
}

export function hashCustomerInput(input: ExternalCustomerInput) {
  return hashContent({
    externalId: input.externalId,
    name: input.name,
    document: input.document,
    email: input.email,
    phone: input.phone,
    status: input.status ?? CustomerStatus.PROSPECT,
    planName: input.planName,
    address: input.address,
  });
}

export function hashContractPayload(input: {
  status: string;
  planName?: string | null;
  serviceLogin?: string | null;
  address?: Prisma.InputJsonValue;
  startedAt?: Date | null;
  endedAt?: Date | null;
}) {
  return hashContent({
    status: input.status,
    planName: input.planName,
    serviceLogin: input.serviceLogin,
    address: input.address,
    startedAt: input.startedAt?.toISOString(),
    endedAt: input.endedAt?.toISOString(),
  });
}

export function hashInvoicePayload(input: {
  status: string;
  amountCents?: number | null;
  dueDate?: Date | null;
  paidAt?: Date | null;
  contractId?: string | null;
}) {
  return hashContent({
    status: input.status,
    amountCents: input.amountCents,
    dueDate: input.dueDate?.toISOString(),
    paidAt: input.paidAt?.toISOString(),
    contractId: input.contractId,
  });
}

function formatBrazilianDate(date: Date) {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

function formatBrazilianDateTime(date: Date) {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
}

export function buildSgpIncrementalFilters(since: Date | null) {
  if (!since) {
    return {};
  }

  const iso = since.toISOString();
  const brDate = formatBrazilianDate(since);
  const brDateTime = formatBrazilianDateTime(since);

  return {
    alterado_desde: iso,
    updated_since: iso,
    data_alteracao_inicio: brDate,
    data_alteracao: brDate,
    data_atualizacao_inicio: brDateTime,
    data_atualizacao: brDateTime,
  };
}

export function readSgpSyncState(config: Prisma.JsonValue | null | undefined): SgpSyncState {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return {};
  }

  const syncState = (config as Record<string, unknown>).syncState;
  if (!syncState || typeof syncState !== "object" || Array.isArray(syncState)) {
    return {};
  }

  const record = syncState as Record<string, unknown>;
  return {
    lastSuccessfulSyncAt:
      typeof record.lastSuccessfulSyncAt === "string"
        ? record.lastSuccessfulSyncAt
        : undefined,
    lastSyncMode:
      record.lastSyncMode === "incremental" || record.lastSyncMode === "full"
        ? record.lastSyncMode
        : undefined,
    lastSyncRunId:
      typeof record.lastSyncRunId === "string" ? record.lastSyncRunId : undefined,
  };
}

export function mergeSgpSyncState(
  config: Prisma.JsonValue | null | undefined,
  syncState: SgpSyncState,
): Prisma.InputJsonObject {
  const base =
    config && typeof config === "object" && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : {};

  return {
    ...base,
    syncState: {
      ...readSgpSyncState(config),
      ...syncState,
    },
  };
}

export function extractSgpUpdatedAt(raw: Record<string, unknown>) {
  const candidates = [
    raw.data_alteracao,
    raw.data_atualizacao,
    raw.alterado_em,
    raw.updated_at,
    raw.updatedAt,
    raw.dt_alteracao,
    raw.dt_atualizacao,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      const parsed = Date.parse(candidate);
      if (!Number.isNaN(parsed)) {
        return new Date(parsed);
      }

      const brMatch = candidate.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
      if (brMatch) {
        const [, day, month, year, hours = "0", minutes = "0", seconds = "0"] = brMatch;
        return new Date(
          Number(year),
          Number(month) - 1,
          Number(day),
          Number(hours),
          Number(minutes),
          Number(seconds),
        );
      }
    }
  }

  return null;
}

export function isChangedSince(raw: Record<string, unknown>, since: Date | null) {
  if (!since) {
    return true;
  }

  const updatedAt = extractSgpUpdatedAt(raw);
  if (!updatedAt) {
    return true;
  }

  return updatedAt.getTime() > since.getTime();
}
