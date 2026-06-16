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
  planName?: string | null;
  createdAt: string;
  updatedAt: string;
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
  health: Array<{ label: string; status: string }>;
};
