export type RunProfileRecord = {
  id: string;
  organizationId?: string;
  name: string;
  slug: string;
  description?: string;
  status: string;
  defaultModel: string;
  allowedModels: string[];
  defaultReasoningEffort: string;
  sandboxMode: string;
  approvalPolicy: string;
  networkAccessEnabled: boolean;
  webSearchMode: string;
  createdAt: string;
  updatedAt: string;
};

type CreateRunProfilePayload = {
  id?: string;
  organizationId?: string;
  name: string;
  slug: string;
  description?: string;
  status?: string;
  defaultModel: string;
  allowedModels: string[];
  defaultReasoningEffort: string;
  sandboxMode: string;
  approvalPolicy: string;
  networkAccessEnabled?: boolean;
  webSearchMode: string;
};

type RunProfileRow = {
  id: string;
  organizationId: string | null;
  name: string;
  slug: string;
  description: string | null;
  status: string | null;
  defaultModel: string;
  allowedModels: unknown;
  defaultReasoningEffort: string;
  sandboxMode: string;
  approvalPolicy: string;
  networkAccessEnabled: boolean;
  webSearchMode: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type RunProfileTable = {
  findUnique(args: { where: { id?: string; slug?: string } }): Promise<RunProfileRow | null>;
  findMany(args?: { orderBy?: { createdAt?: "asc" | "desc"; updatedAt?: "asc" | "desc" } }): Promise<RunProfileRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<RunProfileRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<RunProfileRow>;
};

export type RunProfileRepositoryDb = {
  runProfile: RunProfileTable;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

function normalizeAllowedModels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function mapRunProfile(row: RunProfileRow): RunProfileRecord {
  return {
    id: row.id,
    organizationId: trimOrUndefined(row.organizationId),
    name: row.name,
    slug: row.slug,
    description: trimOrUndefined(row.description),
    status: trimOrUndefined(row.status) ?? "active",
    defaultModel: row.defaultModel,
    allowedModels: normalizeAllowedModels(row.allowedModels),
    defaultReasoningEffort: row.defaultReasoningEffort,
    sandboxMode: row.sandboxMode,
    approvalPolicy: row.approvalPolicy,
    networkAccessEnabled: row.networkAccessEnabled,
    webSearchMode: row.webSearchMode,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

export class RunProfileRepository {
  constructor(private readonly db: RunProfileRepositoryDb) {}

  async create(payload: CreateRunProfilePayload): Promise<RunProfileRecord> {
    const created = await this.db.runProfile.create({
      data: {
        id: trimOrUndefined(payload.id),
        organizationId: trimOrUndefined(payload.organizationId) ?? null,
        name: payload.name,
        slug: payload.slug,
        description: trimOrUndefined(payload.description) ?? null,
        status: trimOrUndefined(payload.status) ?? "active",
        defaultModel: payload.defaultModel,
        allowedModels: normalizeAllowedModels(payload.allowedModels),
        defaultReasoningEffort: payload.defaultReasoningEffort,
        sandboxMode: payload.sandboxMode,
        approvalPolicy: payload.approvalPolicy,
        networkAccessEnabled: payload.networkAccessEnabled ?? false,
        webSearchMode: payload.webSearchMode
      }
    });
    return mapRunProfile(created);
  }

  async get(id: string): Promise<RunProfileRecord | undefined> {
    const runProfileId = trimOrUndefined(id);
    if (!runProfileId) return undefined;
    const row = await this.db.runProfile.findUnique({ where: { id: runProfileId } });
    return row ? mapRunProfile(row) : undefined;
  }

  async list(): Promise<RunProfileRecord[]> {
    const rows = await this.db.runProfile.findMany({
      orderBy: { createdAt: "asc" }
    });
    return rows.map(mapRunProfile);
  }

  async update(id: string, payload: Partial<CreateRunProfilePayload>): Promise<RunProfileRecord> {
    const runProfileId = trimOrUndefined(id);
    if (!runProfileId) {
      throw new Error("run profile 不存在");
    }
    const existing = await this.db.runProfile.findUnique({ where: { id: runProfileId } });
    if (!existing) {
      throw new Error("run profile 不存在");
    }
    const updated = await this.db.runProfile.update({
      where: { id: runProfileId },
      data: {
        organizationId:
          payload.organizationId === undefined ? existing.organizationId : trimOrUndefined(payload.organizationId) ?? null,
        name: payload.name ?? existing.name,
        slug: payload.slug ?? existing.slug,
        description:
          payload.description === undefined ? existing.description : trimOrUndefined(payload.description) ?? null,
        status: payload.status === undefined ? existing.status : trimOrUndefined(payload.status) ?? "active",
        defaultModel: payload.defaultModel ?? existing.defaultModel,
        allowedModels:
          payload.allowedModels === undefined ? normalizeAllowedModels(existing.allowedModels) : normalizeAllowedModels(payload.allowedModels),
        defaultReasoningEffort: payload.defaultReasoningEffort ?? existing.defaultReasoningEffort,
        sandboxMode: payload.sandboxMode ?? existing.sandboxMode,
        approvalPolicy: payload.approvalPolicy ?? existing.approvalPolicy,
        networkAccessEnabled:
          payload.networkAccessEnabled === undefined ? existing.networkAccessEnabled : payload.networkAccessEnabled,
        webSearchMode: payload.webSearchMode ?? existing.webSearchMode,
        updatedAt: new Date()
      }
    });
    return mapRunProfile(updated);
  }
}
