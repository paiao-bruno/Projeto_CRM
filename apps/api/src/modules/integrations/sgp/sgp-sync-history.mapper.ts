import { IntegrationSyncRun, Prisma } from "@prisma/client";
import {
  SgpSyncHistoryEntityStats,
  SgpSyncHistoryEntry,
  SgpSyncHistoryError,
} from "./sgp-sync-history.types";

type SyncRunWithRelations = IntegrationSyncRun & {
  tenant: { id: string; name: string };
  triggeredBy?: {
    id: string;
    displayName: string | null;
    user: { name: string; email: string };
  } | null;
};

function readMetadataStats(
  metadata: Prisma.JsonValue | null | undefined,
  entity: "customers" | "contracts" | "invoices",
) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const record = (metadata as Record<string, unknown>)[entity];
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }

  return record as Record<string, unknown>;
}

function buildEntityStats(
  run: IntegrationSyncRun,
  entity: "customers" | "contracts" | "invoices",
): SgpSyncHistoryEntityStats {
  const metadataStats = readMetadataStats(run.metadata, entity);

  if (entity === "customers") {
    return {
      processed: run.customersProcessed || run.processed,
      created: run.customersCreated || Number(metadataStats?.created ?? 0),
      updated: run.customersUpdated || Number(metadataStats?.updated ?? 0),
      deleted: run.customersDeleted || Number(metadataStats?.deleted ?? 0),
      ignored: run.customersIgnored || Number(metadataStats?.unchanged ?? 0),
    };
  }

  if (entity === "contracts") {
    return {
      processed:
        run.contractsProcessed ||
        run.contractsCreated +
          run.contractsUpdated +
          run.contractsDeleted +
          run.contractsIgnored,
      created: run.contractsCreated || Number(metadataStats?.created ?? 0),
      updated: run.contractsUpdated || Number(metadataStats?.updated ?? 0),
      deleted: run.contractsDeleted || Number(metadataStats?.deleted ?? 0),
      ignored: run.contractsIgnored || Number(metadataStats?.unchanged ?? 0),
    };
  }

  return {
    processed:
      run.invoicesProcessed ||
      run.invoicesCreated + run.invoicesUpdated + run.invoicesDeleted + run.invoicesIgnored,
    created: run.invoicesCreated || Number(metadataStats?.created ?? 0),
    updated: run.invoicesUpdated || Number(metadataStats?.updated ?? 0),
    deleted: run.invoicesDeleted || Number(metadataStats?.deleted ?? 0),
    ignored: run.invoicesIgnored || Number(metadataStats?.unchanged ?? 0),
  };
}

function isErrorRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mapErrorRecord(item: Record<string, unknown>): SgpSyncHistoryError {
  return {
    index: typeof item.index === "number" ? item.index : undefined,
    message: typeof item.message === "string" ? item.message : "Erro desconhecido.",
    entity: typeof item.entity === "string" ? item.entity : undefined,
    externalId: typeof item.externalId === "string" ? item.externalId : undefined,
  };
}

function readErrors(run: IntegrationSyncRun): SgpSyncHistoryError[] {
  if (Array.isArray(run.errors)) {
    return run.errors
      .map((item) => (isErrorRecord(item) ? mapErrorRecord(item) : null))
      .filter((item): item is SgpSyncHistoryError => item !== null);
  }

  if (!run.metadata || typeof run.metadata !== "object" || Array.isArray(run.metadata)) {
    return [];
  }

  const metadataErrors = (run.metadata as Record<string, unknown>).errors;
  if (!Array.isArray(metadataErrors)) {
    return [];
  }

  return metadataErrors.filter(isErrorRecord).map(mapErrorRecord);
}

function readSyncMode(run: IntegrationSyncRun) {
  if (run.syncMode) {
    return run.syncMode;
  }

  if (!run.metadata || typeof run.metadata !== "object" || Array.isArray(run.metadata)) {
    return null;
  }

  const syncMode = (run.metadata as Record<string, unknown>).syncMode;
  return typeof syncMode === "string" ? syncMode : null;
}

function readTrigger(run: IntegrationSyncRun) {
  if (run.trigger) {
    return run.trigger;
  }

  if (!run.metadata || typeof run.metadata !== "object" || Array.isArray(run.metadata)) {
    return null;
  }

  const trigger = (run.metadata as Record<string, unknown>).trigger;
  return typeof trigger === "string" ? trigger : null;
}

export function mapSgpSyncHistoryEntry(run: SyncRunWithRelations): SgpSyncHistoryEntry {
  const customers = buildEntityStats(run, "customers");
  const contracts = buildEntityStats(run, "contracts");
  const invoices = buildEntityStats(run, "invoices");

  return {
    id: run.id,
    operation: run.operation,
    status: run.status,
    syncMode: readSyncMode(run),
    trigger: readTrigger(run),
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    durationMs: run.durationMs,
    tenant: {
      id: run.tenant.id,
      name: run.tenant.name,
    },
    triggeredBy: run.triggeredBy
      ? {
          id: run.triggeredBy.id,
          name: run.triggeredBy.displayName ?? run.triggeredBy.user.name,
          email: run.triggeredBy.user.email,
        }
      : null,
    integrationId: run.integrationId,
    customers,
    contracts,
    invoices,
    created: run.created,
    updated: run.updated,
    deleted: customers.deleted + contracts.deleted + invoices.deleted,
    ignored: run.ignored,
    errorsCount: run.errorsCount,
    errors: readErrors(run),
    errorMessage: run.errorMessage,
    stackTrace:
      process.env.NODE_ENV === "production" ? null : run.stackTrace,
  };
}
