import { IntegrationSyncStatus } from "@prisma/client";

export type SgpSyncHistoryError = {
  index?: number;
  message: string;
  entity?: string;
  externalId?: string;
};

export type SgpSyncHistoryEntityStats = {
  processed: number;
  created: number;
  updated: number;
  deleted: number;
  ignored: number;
};

export type SgpSyncHistoryEntry = {
  id: string;
  operation: string;
  status: IntegrationSyncStatus;
  syncMode: string | null;
  trigger: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  tenant: {
    id: string;
    name: string;
  };
  triggeredBy: {
    id: string;
    name: string;
    email: string;
  } | null;
  integrationId: string | null;
  customers: SgpSyncHistoryEntityStats;
  contracts: SgpSyncHistoryEntityStats;
  invoices: SgpSyncHistoryEntityStats;
  created: number;
  updated: number;
  deleted: number;
  ignored: number;
  errorsCount: number;
  errors: SgpSyncHistoryError[];
  errorMessage: string | null;
  stackTrace: string | null;
};

export type SgpSyncHistoryListResponse = {
  items: SgpSyncHistoryEntry[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};
