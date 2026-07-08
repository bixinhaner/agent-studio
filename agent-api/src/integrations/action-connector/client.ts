export type ActionDescriptor = {
  id: string;
  title: string;
  description?: string;
  risk: "read" | "low" | "high" | string;
  scopes?: string[];
  inputSchema?: Record<string, unknown>;
};

export type ConnectorActionRequest = {
  actionId: string;
  input?: Record<string, unknown>;
  dryRun?: boolean;
};

export type ConnectorIdentity = {
  externalUserId?: string;
  externalUserName?: string;
  externalUnionId?: string;
  organizationId?: string;
  scopes?: string[];
  roles?: string[];
  metadata?: Record<string, unknown>;
};
