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

export type FakeUsageEventFindManyWhere = {
  organizationId?: string | null;
  userId?: string;
  departmentIdSnapshot?: string;
  threadId?: string;
  sessionId?: string;
  model?: string;
  featureType?: string;
  resultStatus?: string;
  createdAt?: { gte?: Date; lt?: Date };
};

export type FakeUsageDailyRollupRow = {
  id: string;
  organizationId: string | null;
  rollupDate: string;
  scopeType: string;
  scopeId: string;
  model: string | null;
  featureType: string | null;
  requestCount: number;
  successCount: number;
  failureCount: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimatedCost: string;
  internalCost: string;
  createdAt: Date;
  updatedAt: Date;
};

export type FakeQuotaPolicyRow = {
  id: string;
  organizationId: string | null;
  scopeType: string;
  scopeId: string;
  featureType: string | null;
  model: string | null;
  metricType: string;
  windowType: string;
  thresholdValue: string;
  enforcementMode: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
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

export type FakeAlertRuleRow = {
  id: string;
  organizationId: string | null;
  scopeType: string;
  scopeId: string;
  ruleType: string;
  name: string;
  description: string | null;
  conditions: unknown;
  channels: unknown;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type FakeAlertEventRow = {
  id: string;
  organizationId: string | null;
  alertRuleId: string | null;
  scopeType: string;
  scopeId: string;
  severity: string;
  status: string;
  title: string;
  detail: string;
  payload: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export type FakeNotificationRecordRow = {
  id: string;
  organizationId: string | null;
  channelType: string;
  targetRef: string;
  eventType: string;
  status: string;
  payload: unknown;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class FakeOperationsDb {
  private resourceAccessLogCounter = 0;
  private usageEventCounter = 0;
  private usageDailyRollupCounter = 0;
  private quotaPolicyCounter = 0;
  private costProfileCounter = 0;
  private alertRuleCounter = 0;
  private alertEventCounter = 0;
  private notificationRecordCounter = 0;

  constructor(
    readonly resourceAccessLogs: FakeResourceAccessLogRow[] = [],
    readonly usageEvents: FakeUsageEventRow[] = [],
    readonly usageDailyRollups: FakeUsageDailyRollupRow[] = [],
    readonly quotaPolicies: FakeQuotaPolicyRow[] = [],
    readonly costProfiles: FakeCostProfileRow[] = [],
    readonly alertRules: FakeAlertRuleRow[] = [],
    readonly alertEvents: FakeAlertEventRow[] = [],
    readonly notificationRecords: FakeNotificationRecordRow[] = []
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
      where?: FakeUsageEventFindManyWhere;
      orderBy?: { createdAt?: "asc" | "desc" };
      take?: number;
    } = {}) => {
      const rows = this.usageEvents.filter((item) => {
        if ("organizationId" in (where ?? {}) && item.organizationId !== (where?.organizationId ?? null)) return false;
        if (where?.userId && item.userId !== where.userId) return false;
        if (where?.departmentIdSnapshot && item.departmentIdSnapshot !== where.departmentIdSnapshot) return false;
        if (where?.threadId && item.threadId !== where.threadId) return false;
        if (where?.createdAt?.gte && item.createdAt < where.createdAt.gte) return false;
        if (where?.createdAt?.lt && item.createdAt >= where.createdAt.lt) return false;
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

  readonly usageDailyRollup = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeUsageDailyRollupRow = {
        id: typeof data.id === "string" ? data.id : `usage-daily-rollup-${++this.usageDailyRollupCounter}`,
        organizationId: typeof data.organizationId === "string" ? data.organizationId : null,
        rollupDate: String(data.rollupDate ?? ""),
        scopeType: String(data.scopeType ?? ""),
        scopeId: String(data.scopeId ?? ""),
        model: typeof data.model === "string" ? data.model : null,
        featureType: typeof data.featureType === "string" ? data.featureType : null,
        requestCount: Number(data.requestCount ?? 0),
        successCount: Number(data.successCount ?? 0),
        failureCount: Number(data.failureCount ?? 0),
        inputTokens: Number(data.inputTokens ?? 0),
        cachedInputTokens: Number(data.cachedInputTokens ?? 0),
        outputTokens: Number(data.outputTokens ?? 0),
        estimatedCost: String(data.estimatedCost ?? "0"),
        internalCost: String(data.internalCost ?? "0"),
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.usageDailyRollups.push(row);
      return clone(row);
    },
    findMany: async ({
      where,
      orderBy
    }: {
      where?: {
        organizationId?: string | null;
        rollupDate?: string;
        scopeType?: string;
        scopeId?: string;
        model?: string | null;
        featureType?: string | null;
      };
      orderBy?: { createdAt?: "asc" | "desc" };
    } = {}) => {
      const rows = this.usageDailyRollups.filter((item) => {
        if ("organizationId" in (where ?? {}) && item.organizationId !== (where?.organizationId ?? null)) return false;
        if (where?.rollupDate && item.rollupDate !== where.rollupDate) return false;
        if (where?.scopeType && item.scopeType !== where.scopeType) return false;
        if (where?.scopeId && item.scopeId !== where.scopeId) return false;
        if ("model" in (where ?? {}) && item.model !== (where?.model ?? null)) return false;
        if ("featureType" in (where ?? {}) && item.featureType !== (where?.featureType ?? null)) return false;
        return true;
      });
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(rows);
    },
    deleteMany: async ({
      where
    }: {
      where?: {
        organizationId?: string | null;
        rollupDate?: string;
      };
    } = {}) => {
      const before = this.usageDailyRollups.length;
      for (let index = this.usageDailyRollups.length - 1; index >= 0; index -= 1) {
        const item = this.usageDailyRollups[index];
        if ("organizationId" in (where ?? {}) && item.organizationId !== (where?.organizationId ?? null)) continue;
        if (where?.rollupDate && item.rollupDate !== where.rollupDate) continue;
        this.usageDailyRollups.splice(index, 1);
      }
      return { count: before - this.usageDailyRollups.length };
    }
  };

  readonly quotaPolicy = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeQuotaPolicyRow = {
        id: typeof data.id === "string" ? data.id : `quota-policy-${++this.quotaPolicyCounter}`,
        organizationId: typeof data.organizationId === "string" ? data.organizationId : null,
        scopeType: String(data.scopeType ?? ""),
        scopeId: String(data.scopeId ?? ""),
        featureType: typeof data.featureType === "string" ? data.featureType : null,
        model: typeof data.model === "string" ? data.model : null,
        metricType: String(data.metricType ?? ""),
        windowType: String(data.windowType ?? ""),
        thresholdValue: String(data.thresholdValue ?? "0"),
        enforcementMode: String(data.enforcementMode ?? "soft_block"),
        isActive: typeof data.isActive === "boolean" ? data.isActive : true,
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.quotaPolicies.push(row);
      return clone(row);
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.quotaPolicies.find((item) => item.id === where.id);
      if (!row) throw new Error("quota policy not found");
      Object.assign(row, clone(data));
      row.updatedAt = data.updatedAt instanceof Date ? data.updatedAt : new Date();
      return clone(row);
    },
    findFirst: async ({
      where
    }: {
      where?: {
        organizationId?: string | null;
        scopeType?: string;
        scopeId?: string;
        featureType?: string | null;
        model?: string | null;
        metricType?: string;
        windowType?: string;
        isActive?: boolean;
      };
      orderBy?: { createdAt?: "asc" | "desc" };
    } = {}) => {
      const row = this.quotaPolicies.find((item) => {
        if ("organizationId" in (where ?? {}) && item.organizationId !== (where?.organizationId ?? null)) return false;
        if (where?.scopeType && item.scopeType !== where.scopeType) return false;
        if (where?.scopeId && item.scopeId !== where.scopeId) return false;
        if ("featureType" in (where ?? {}) && item.featureType !== (where?.featureType ?? null)) return false;
        if ("model" in (where ?? {}) && item.model !== (where?.model ?? null)) return false;
        if (where?.metricType && item.metricType !== where.metricType) return false;
        if (where?.windowType && item.windowType !== where.windowType) return false;
        if (typeof where?.isActive === "boolean" && item.isActive !== where.isActive) return false;
        return true;
      });
      return row ? clone(row) : null;
    },
    findMany: async ({
      where,
      orderBy
    }: {
      where?: {
        organizationId?: string | null;
        scopeType?: string;
        scopeId?: string;
        featureType?: string | null;
        model?: string | null;
        metricType?: string;
        windowType?: string;
        isActive?: boolean;
      };
      orderBy?: { createdAt?: "asc" | "desc" };
    } = {}) => {
      const rows = this.quotaPolicies.filter((item) => {
        if ("organizationId" in (where ?? {}) && item.organizationId !== (where?.organizationId ?? null)) return false;
        if (where?.scopeType && item.scopeType !== where.scopeType) return false;
        if (where?.scopeId && item.scopeId !== where.scopeId) return false;
        if ("featureType" in (where ?? {}) && item.featureType !== (where?.featureType ?? null)) return false;
        if ("model" in (where ?? {}) && item.model !== (where?.model ?? null)) return false;
        if (where?.metricType && item.metricType !== where.metricType) return false;
        if (where?.windowType && item.windowType !== where.windowType) return false;
        if (typeof where?.isActive === "boolean" && item.isActive !== where.isActive) return false;
        return true;
      });
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(rows);
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

  readonly alertRule = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeAlertRuleRow = {
        id: typeof data.id === "string" ? data.id : `alert-rule-${++this.alertRuleCounter}`,
        organizationId: typeof data.organizationId === "string" ? data.organizationId : null,
        scopeType: String(data.scopeType ?? ""),
        scopeId: String(data.scopeId ?? ""),
        ruleType: String(data.ruleType ?? ""),
        name: String(data.name ?? ""),
        description: typeof data.description === "string" ? data.description : null,
        conditions: data.conditions ?? null,
        channels: data.channels ?? [],
        isActive: typeof data.isActive === "boolean" ? data.isActive : true,
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.alertRules.push(row);
      return clone(row);
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.alertRules.find((item) => item.id === where.id);
      if (!row) throw new Error("alert rule not found");
      Object.assign(row, clone(data));
      row.updatedAt = data.updatedAt instanceof Date ? data.updatedAt : new Date();
      return clone(row);
    },
    findFirst: async ({
      where
    }: {
      where?: {
        organizationId?: string | null;
        scopeType?: string;
        scopeId?: string;
        ruleType?: string;
        isActive?: boolean;
      };
      orderBy?: { createdAt?: "asc" | "desc" };
    } = {}) => {
      const row = this.alertRules.find((item) => {
        if ("organizationId" in (where ?? {}) && item.organizationId !== (where?.organizationId ?? null)) return false;
        if (where?.scopeType && item.scopeType !== where.scopeType) return false;
        if (where?.scopeId && item.scopeId !== where.scopeId) return false;
        if (where?.ruleType && item.ruleType !== where.ruleType) return false;
        if (typeof where?.isActive === "boolean" && item.isActive !== where.isActive) return false;
        return true;
      });
      return row ? clone(row) : null;
    },
    findMany: async ({
      where,
      orderBy
    }: {
      where?: {
        organizationId?: string | null;
        scopeType?: string;
        scopeId?: string;
        ruleType?: string;
        isActive?: boolean;
      };
      orderBy?: { createdAt?: "asc" | "desc" };
    } = {}) => {
      const rows = this.alertRules.filter((item) => {
        if ("organizationId" in (where ?? {}) && item.organizationId !== (where?.organizationId ?? null)) return false;
        if (where?.scopeType && item.scopeType !== where.scopeType) return false;
        if (where?.scopeId && item.scopeId !== where.scopeId) return false;
        if (where?.ruleType && item.ruleType !== where.ruleType) return false;
        if (typeof where?.isActive === "boolean" && item.isActive !== where.isActive) return false;
        return true;
      });
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(rows);
    }
  };

  readonly alertEvent = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeAlertEventRow = {
        id: typeof data.id === "string" ? data.id : `alert-event-${++this.alertEventCounter}`,
        organizationId: typeof data.organizationId === "string" ? data.organizationId : null,
        alertRuleId: typeof data.alertRuleId === "string" ? data.alertRuleId : null,
        scopeType: String(data.scopeType ?? ""),
        scopeId: String(data.scopeId ?? ""),
        severity: String(data.severity ?? ""),
        status: String(data.status ?? ""),
        title: String(data.title ?? ""),
        detail: String(data.detail ?? ""),
        payload: data.payload ?? null,
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.alertEvents.push(row);
      return clone(row);
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.alertEvents.find((item) => item.id === where.id);
      if (!row) throw new Error("alert event not found");
      Object.assign(row, clone(data));
      row.updatedAt = data.updatedAt instanceof Date ? data.updatedAt : new Date();
      return clone(row);
    },
    findMany: async ({
      where,
      orderBy,
      take
    }: {
      where?: {
        organizationId?: string | null;
        alertRuleId?: string | null;
        scopeType?: string;
        scopeId?: string;
        severity?: string;
        status?: string;
      };
      orderBy?: { createdAt?: "asc" | "desc" };
      take?: number;
    } = {}) => {
      const rows = this.alertEvents.filter((item) => {
        if ("organizationId" in (where ?? {}) && item.organizationId !== (where?.organizationId ?? null)) return false;
        if ("alertRuleId" in (where ?? {}) && item.alertRuleId !== (where?.alertRuleId ?? null)) return false;
        if (where?.scopeType && item.scopeType !== where.scopeType) return false;
        if (where?.scopeId && item.scopeId !== where.scopeId) return false;
        if (where?.severity && item.severity !== where.severity) return false;
        if (where?.status && item.status !== where.status) return false;
        return true;
      });
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(typeof take === "number" ? rows.slice(0, take) : rows);
    }
  };

  readonly notificationRecord = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeNotificationRecordRow = {
        id: typeof data.id === "string" ? data.id : `notification-record-${++this.notificationRecordCounter}`,
        organizationId: typeof data.organizationId === "string" ? data.organizationId : null,
        channelType: String(data.channelType ?? ""),
        targetRef: String(data.targetRef ?? ""),
        eventType: String(data.eventType ?? ""),
        status: String(data.status ?? ""),
        payload: data.payload ?? null,
        errorMessage: typeof data.errorMessage === "string" ? data.errorMessage : null,
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.notificationRecords.push(row);
      return clone(row);
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.notificationRecords.find((item) => item.id === where.id);
      if (!row) throw new Error("notification record not found");
      Object.assign(row, clone(data));
      row.updatedAt = data.updatedAt instanceof Date ? data.updatedAt : new Date();
      return clone(row);
    },
    findMany: async ({
      where,
      orderBy,
      take
    }: {
      where?: {
        organizationId?: string | null;
        channelType?: string;
        targetRef?: string;
        eventType?: string;
        status?: string;
      };
      orderBy?: { createdAt?: "asc" | "desc" };
      take?: number;
    } = {}) => {
      const rows = this.notificationRecords.filter((item) => {
        if ("organizationId" in (where ?? {}) && item.organizationId !== (where?.organizationId ?? null)) return false;
        if (where?.channelType && item.channelType !== where.channelType) return false;
        if (where?.targetRef && item.targetRef !== where.targetRef) return false;
        if (where?.eventType && item.eventType !== where.eventType) return false;
        if (where?.status && item.status !== where.status) return false;
        return true;
      });
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(typeof take === "number" ? rows.slice(0, take) : rows);
    }
  };
}
