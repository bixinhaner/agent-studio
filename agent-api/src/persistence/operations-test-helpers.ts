export type FakeResourceAccessLogRow = {
  id: string;
  organizationId: string | null;
  userId: string | null;
  departmentIdSnapshot: string | null;
  threadId: string | null;
  sessionId: string | null;
  resourceType: string;
  resourceId: string;
  actionType: string;
  resultStatus: string;
  metadata: unknown;
  createdAt: Date;
};

export type FakeUsageEventRow = {
  id: string;
  organizationId: string | null;
  userId: string | null;
  departmentIdSnapshot: string | null;
  threadId: string | null;
  sessionId: string | null;
  model: string;
  featureType: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimatedCost: string;
  internalCost: string;
  resultStatus: string;
  metadata: unknown;
  createdAt: Date;
};

export type FakeCostProfileRow = {
  id: string;
  organizationId: string | null;
  model: string;
  inputTokenPrice: string;
  cachedInputTokenPrice: string;
  outputTokenPrice: string;
  internalCostMultiplier: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class FakeOperationsDb {
  private resourceAccessLogCounter = 0;
  private usageEventCounter = 0;
  private costProfileCounter = 0;

  constructor(
    readonly resourceAccessLogs: FakeResourceAccessLogRow[] = [],
    readonly usageEvents: FakeUsageEventRow[] = [],
    readonly costProfiles: FakeCostProfileRow[] = []
  ) {}

  readonly resourceAccessLog = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row: FakeResourceAccessLogRow = {
        id: typeof data.id === "string" ? data.id : `resource-access-log-${++this.resourceAccessLogCounter}`,
        organizationId: typeof data.organizationId === "string" ? data.organizationId : null,
        userId: typeof data.userId === "string" ? data.userId : null,
        departmentIdSnapshot: typeof data.departmentIdSnapshot === "string" ? data.departmentIdSnapshot : null,
        threadId: typeof data.threadId === "string" ? data.threadId : null,
        sessionId: typeof data.sessionId === "string" ? data.sessionId : null,
        resourceType: String(data.resourceType ?? ""),
        resourceId: String(data.resourceId ?? ""),
        actionType: String(data.actionType ?? ""),
        resultStatus: String(data.resultStatus ?? ""),
        metadata: data.metadata ?? null,
        createdAt: data.createdAt instanceof Date ? data.createdAt : new Date()
      };
      this.resourceAccessLogs.push(row);
      return clone(row);
    },
    findMany: async ({
      where,
      orderBy,
      take
    }: {
      where?: {
        userId?: string;
        resourceType?: string;
        resultStatus?: string;
        actionType?: string;
      };
      orderBy?: { createdAt?: "asc" | "desc" };
      take?: number;
    } = {}) => {
      const rows = this.resourceAccessLogs.filter((item) => {
        if (where?.userId && item.userId !== where.userId) return false;
        if (where?.resourceType && item.resourceType !== where.resourceType) return false;
        if (where?.resultStatus && item.resultStatus !== where.resultStatus) return false;
        if (where?.actionType && item.actionType !== where.actionType) return false;
        return true;
      });
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(typeof take === "number" ? rows.slice(0, take) : rows);
    }
  };

  readonly usageEvent = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row: FakeUsageEventRow = {
        id: typeof data.id === "string" ? data.id : `usage-event-${++this.usageEventCounter}`,
        organizationId: typeof data.organizationId === "string" ? data.organizationId : null,
        userId: typeof data.userId === "string" ? data.userId : null,
        departmentIdSnapshot: typeof data.departmentIdSnapshot === "string" ? data.departmentIdSnapshot : null,
        threadId: typeof data.threadId === "string" ? data.threadId : null,
        sessionId: typeof data.sessionId === "string" ? data.sessionId : null,
        model: String(data.model ?? ""),
        featureType: String(data.featureType ?? ""),
        inputTokens: Number(data.inputTokens ?? 0),
        cachedInputTokens: Number(data.cachedInputTokens ?? 0),
        outputTokens: Number(data.outputTokens ?? 0),
        estimatedCost: String(data.estimatedCost ?? "0"),
        internalCost: String(data.internalCost ?? "0"),
        resultStatus: String(data.resultStatus ?? ""),
        metadata: data.metadata ?? null,
        createdAt: data.createdAt instanceof Date ? data.createdAt : new Date()
      };
      this.usageEvents.push(row);
      return clone(row);
    },
    findMany: async ({
      where,
      orderBy,
      take
    }: {
      where?: {
        model?: string;
        featureType?: string;
        resultStatus?: string;
        sessionId?: string;
      };
      orderBy?: { createdAt?: "asc" | "desc" };
      take?: number;
    } = {}) => {
      const rows = this.usageEvents.filter((item) => {
        if (where?.model && item.model !== where.model) return false;
        if (where?.featureType && item.featureType !== where.featureType) return false;
        if (where?.resultStatus && item.resultStatus !== where.resultStatus) return false;
        if (where?.sessionId && item.sessionId !== where.sessionId) return false;
        return true;
      });
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(typeof take === "number" ? rows.slice(0, take) : rows);
    }
  };

  readonly costProfile = {
    findMany: async ({
      where,
      orderBy
    }: {
      where?: { isActive?: boolean; model?: string };
      orderBy?: { createdAt?: "asc" | "desc" };
    } = {}) => {
      const rows = this.costProfiles.filter((item) => {
        if (typeof where?.isActive === "boolean" && item.isActive !== where.isActive) return false;
        if (where?.model && item.model !== where.model) return false;
        return true;
      });
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(rows);
    },
    findFirst: async ({
      where
    }: {
      where?: { organizationId?: string | null; model?: string; isActive?: boolean };
      orderBy?: { createdAt?: "asc" | "desc" };
    } = {}) => {
      const row = this.costProfiles.find((item) => {
        if ("organizationId" in (where ?? {}) && item.organizationId !== (where?.organizationId ?? null)) return false;
        if (where?.model && item.model !== where.model) return false;
        if (typeof where?.isActive === "boolean" && item.isActive !== where.isActive) return false;
        return true;
      });
      return row ? clone(row) : null;
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeCostProfileRow = {
        id: typeof data.id === "string" ? data.id : `cost-profile-${++this.costProfileCounter}`,
        organizationId: typeof data.organizationId === "string" ? data.organizationId : null,
        model: String(data.model ?? ""),
        inputTokenPrice: String(data.inputTokenPrice ?? "0"),
        cachedInputTokenPrice: String(data.cachedInputTokenPrice ?? "0"),
        outputTokenPrice: String(data.outputTokenPrice ?? "0"),
        internalCostMultiplier: String(data.internalCostMultiplier ?? "1"),
        isActive: typeof data.isActive === "boolean" ? data.isActive : true,
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.costProfiles.push(row);
      return clone(row);
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.costProfiles.find((item) => item.id === where.id);
      if (!row) throw new Error("cost profile not found");
      Object.assign(row, clone(data));
      row.updatedAt = data.updatedAt instanceof Date ? data.updatedAt : new Date();
      return clone(row);
    }
  };
}
