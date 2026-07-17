export type AuthUser = {
  sub: string;
  email: string;
  name: string;
  tenantId: string;
  tenantName: string;
  memberId: string;
  role: string;
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

export type SgpSyncStartResponse = {
  status: "started" | "already_running";
  runId: string;
  message: string;
};

export type SgpDiscoveryPreview = {
  processed: number;
  pagination?: Record<string, unknown>;
  customers: Array<{
    customer: {
      externalId?: string;
      name: string;
      document?: string;
      email?: string;
      phone?: string;
      planName?: string;
    };
    contractsCount: number;
    invoicesCount: number;
  }>;
};

export type SgpSyncResult = {
  processed: number;
  created: number;
  updated: number;
  contractsCreated: number;
  contractsUpdated: number;
  invoicesCreated: number;
  invoicesUpdated: number;
  ignored: number;
  errors: Array<{ index: number; message: string }>;
  durationMs: number;
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

export type SgpSyncHistoryEntityStats = {
  processed: number;
  created: number;
  updated: number;
  deleted: number;
  ignored: number;
};

export type SgpSyncHistoryError = {
  index?: number;
  message: string;
  entity?: string;
  externalId?: string;
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

export type SgpSyncHistoryDetail = SgpSyncHistoryEntry & {
  logs?: IntegrationSyncLog[];
};

export type SgpSyncHistoryListResponse = {
  items: SgpSyncHistoryEntry[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type IntegrationSyncRun = SgpSyncHistoryDetail;

export type SgpCredentials = {
  id: string;
  tenantId: string;
  name: string;
  status: string;
  healthStatus: string;
  apiUrl: string;
  apiPort?: string | null;
  timeoutMs?: number | null;
  app: string;
  tokenConfigured: boolean;
  tokenPreview?: string | null;
  lastConnectedAt?: string | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SgpCredentialsInput = {
  name?: string;
  apiUrl: string;
  apiPort?: string;
  timeoutMs?: number;
  app: string;
  token: string;
};

export type SgpCredentialsUpdateInput = Partial<SgpCredentialsInput> & {
  status?: string;
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

export type DashboardOverview = {
  cards: {
    messagesProcessed: number;
    activeConversations: number;
    onlineAgents: number;
    responseRate: number;
    averageResponseTime: string;
    conversions: number;
    activeContracts: number;
    overdueInvoices: number;
  };
  chart: Array<{ date: string; inbound: number; outbound: number }>;
  channelDistribution: Array<{
    name: string;
    value: number;
    percentage: number;
    color: string;
  }>;
  agentPerformance: Array<{
    name: string;
    messagesProcessed: number;
    color: string;
  }>;
  agentMemory: {
    summary: {
      totalAgents: number;
      activeAgents: number;
      averageLearning: number;
      totalMemoriesRegistered: number;
      acquiredToday: number;
      acquiredThisWeek: number;
      acquiredThisMonth: number;
      growthRate: number;
    };
    agents: Array<{
      id: string;
      name: string;
      function: string;
      status: "ACTIVE" | "INACTIVE" | "TRAINING" | "ERROR";
      learnedMemories: number;
      totalMemories: number;
      remainingMemories: number;
      learningPercentage: number;
      level: "BEGINNER" | "LEARNING" | "DEVELOPING" | "EXPERIENCED" | "MASTER";
      levelLabel: string;
      levelColor: string;
      lastUpdate: string;
      acquiredToday: number;
      acquiredThisWeek: number;
      acquiredThisMonth: number;
      growthRate: number;
    }>;
    chart: Array<{
      date: string;
      dailyGrowth: number;
      weeklyGrowth: number;
    }>;
    stages: Array<{
      level: string;
      label: string;
      range: string;
      color: string;
    }>;
  };
  health: Array<{ label: string; status: string }>;
};
