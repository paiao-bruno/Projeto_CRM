export type AuthUser = {
  sub: string;
  sid?: string;
  email: string;
  name: string;
  tenantId: string;
  tenantName: string;
  memberId: string;
  role: string;
  permissions?: string[];
};

export type LoginResponse = {
  accessToken: string;
  user: AuthUser;
};

export type Customer = {
  id: string;
  name: string;
  document?: string | null;
  email?: string | null;
  phone?: string | null;
  status: "ACTIVE" | "INACTIVE" | "OVERDUE" | "CHURNED" | "PROSPECT";
  ispAccountCode?: string | null;
  planName?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type PaginatedResponse<T> = {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export type Contract = {
  id: string;
  customerId: string;
  externalId: string;
  status: "ACTIVE" | "INACTIVE" | "SUSPENDED" | "CANCELED" | "UNKNOWN";
  planName?: string | null;
  serviceLogin?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Invoice = {
  id: string;
  customerId: string;
  contractId?: string | null;
  externalId: string;
  status: "OPEN" | "PAID" | "OVERDUE" | "CANCELED" | "UNKNOWN";
  amountCents?: number | null;
  dueDate?: string | null;
  paidAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IntegrationSyncStatus = "RUNNING" | "COMPLETED" | "FAILED" | "PARTIAL" | "SKIPPED";

export type IntegrationSyncLog = {
  id: string;
  entity: "CUSTOMER" | "CONTRACT" | "INVOICE";
  externalId?: string | null;
  action: string;
  status: IntegrationSyncStatus;
  message?: string | null;
  createdAt: string;
};

export type AiAgent = {
  id: string;
  name: string;
  description?: string | null;
  provider: "OPENAI" | "CLAUDE" | "GEMINI";
  model: string;
  systemPrompt: string;
  temperature?: string | null;
  maxTokens?: number | null;
  status: "ACTIVE" | "INACTIVE" | "TRAINING" | "ERROR";
  isDefault: boolean;
};

export type Message = {
  id: string;
  senderType: "CUSTOMER" | "USER" | "AI_AGENT" | "SYSTEM";
  direction: "INBOUND" | "OUTBOUND" | "INTERNAL";
  body?: string | null;
  createdAt: string;
  senderMember?: { user: { name: string } } | null;
  senderCustomer?: Customer | null;
  senderAiAgent?: AiAgent | null;
};

export type Conversation = {
  id: string;
  subject?: string | null;
  status: "OPEN" | "PENDING" | "SOLVED" | "ARCHIVED";
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  lastMessageAt?: string | null;
  customer?: Customer | null;
  activeAiAgent?: AiAgent | null;
  messages: Message[];
};

export type DealPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type DealStatus = "OPEN" | "WON" | "LOST";

export type TenantMemberSummary = {
  id: string;
  displayName: string | null;
  jobTitle: string | null;
  user: { id: string; name: string; email: string };
};

export type DealStage = {
  id: string;
  name: string;
  code: string | null;
  color: string | null;
  position: number;
};

export type DealOwner = {
  id: string;
  displayName: string | null;
  user: { name: string };
};

export type DealSummary = {
  id: string;
  title: string;
  phone?: string | null;
  email?: string | null;
  clientType?: string | null;
  entrySource?: string | null;
  contactType?: string | null;
  city?: string | null;
  neighborhood?: string | null;
  priority: DealPriority;
  valueCents: number;
  status: DealStatus;
  position: number;
  nextAction?: string | null;
  nextActionAt?: string | null;
  notes?: string | null;
  lossReason?: string | null;
  archivedAt?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  stage: DealStage;
  ownerMember?: DealOwner | null;
};

export type DealHistoryEntry = {
  id: string;
  action: string;
  fieldName?: string | null;
  previousValue?: unknown;
  newValue?: unknown;
  createdAt: string;
  actor?: {
    id: string;
    displayName: string | null;
    user: { name: string };
  } | null;
};

export type DealDetail = DealSummary & {
  history?: DealHistoryEntry[];
};

export type SalesFunnelBoard = {
  pipeline: { id: string; name: string; isDefault: boolean };
  stages: Array<DealStage & { deals: DealSummary[]; count: number }>;
};

export type SalesFunnelMetrics = {
  definitions: {
    overallConversion: string;
    stageConversion: string;
  };
  totals: {
    open: number;
    won: number;
    lost: number;
    createdInPeriod: number;
    activatedInPeriod: number;
    overdueNextAction: number;
    withoutOwner: number;
    estimatedValueCents: number;
    overallConversionRate: number | null;
  };
  byStage: Array<{ code: string; name: string; count: number }>;
  stageConversion: Array<{ from: string; to: string; rate: number | null }>;
  segments: {
    entrySource: Array<{ key: string; count: number }>;
    clientType: Array<{ key: string; count: number }>;
    contactType: Array<{ key: string; count: number }>;
    city: Array<{ key: string; count: number }>;
    neighborhood: Array<{ key: string; count: number }>;
    owner: Array<{ key: string; count: number }>;
  };
};

export type SalesFunnelFilters = {
  search?: string;
  stageCode?: string;
  ownerMemberId?: string;
  entrySource?: string;
  clientType?: string;
  contactType?: string;
  city?: string;
  neighborhood?: string;
  priority?: DealPriority;
  includeArchived?: boolean;
  includeLost?: boolean;
  createdFrom?: string;
  createdTo?: string;
};
