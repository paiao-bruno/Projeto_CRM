export type SgpIntegrationConfig = {
  apiUrl: string;
  apiPort?: string;
  timeoutMs?: number;
};

export type SgpIntegrationSecrets = {
  app: string;
  token: string;
};

export type SgpRuntimeCredentials = SgpIntegrationConfig & SgpIntegrationSecrets;

export type SgpCredentialsPublicView = {
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
  lastConnectedAt?: Date | null;
  lastError?: string | null;
  createdAt: Date;
  updatedAt: Date;
};
