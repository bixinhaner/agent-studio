export type AlertRuleScopeType = "platform" | "department";
export type AlertRuleType = "quota" | "security";

export type AlertRuleRecord = {
  id: string;
  organizationId?: string;
  scopeType: AlertRuleScopeType;
  scopeId: string;
  ruleType: AlertRuleType;
  name: string;
  description?: string;
  conditions?: unknown;
  channels: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateAlertRuleInput = {
  id?: string;
  organizationId?: string;
  scopeType: AlertRuleScopeType;
  scopeId: string;
  ruleType: AlertRuleType;
  name: string;
  description?: string;
  conditions?: unknown;
  channels?: string[];
  isActive?: boolean;
};

export type UpdateAlertRuleInput = {
  name?: string;
  description?: string | null;
  conditions?: unknown;
  channels?: string[];
  isActive?: boolean;
};

export type ListAlertRulesInput = {
  organizationId?: string | null;
  scopeType?: AlertRuleScopeType;
  scopeId?: string;
  ruleType?: AlertRuleType;
  isActive?: boolean;
};

type AlertRuleRow = {
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
  createdAt: Date | string;
  updatedAt: Date | string;
};

type AlertRuleTable = {
  create(args: { data: Record<string, unknown> }): Promise<AlertRuleRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<AlertRuleRow>;
  findFirst(args?: {
    where?: {
      organizationId?: string | null;
      scopeType?: string;
      scopeId?: string;
      ruleType?: string;
      isActive?: boolean;
    };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<AlertRuleRow | null>;
  findMany(args?: {
    where?: {
      organizationId?: string | null;
      scopeType?: string;
      scopeId?: string;
      ruleType?: string;
      isActive?: boolean;
    };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<AlertRuleRow[]>;
};

export type AlertRuleRepositoryDb = {
  alertRule: AlertRuleTable;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function normalizeChannels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function mapAlertRule(row: AlertRuleRow): AlertRuleRecord {
  return {
    id: row.id,
    organizationId: trimOrUndefined(row.organizationId),
    scopeType: row.scopeType as AlertRuleScopeType,
    scopeId: row.scopeId,
    ruleType: row.ruleType as AlertRuleType,
    name: row.name,
    description: trimOrUndefined(row.description),
    conditions: row.conditions ?? undefined,
    channels: normalizeChannels(row.channels),
    isActive: row.isActive,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

export class AlertRuleRepository {
  constructor(private readonly db: AlertRuleRepositoryDb) {}

  async create(input: CreateAlertRuleInput): Promise<AlertRuleRecord> {
    const scopeId = trimOrUndefined(input.scopeId);
    const name = trimOrUndefined(input.name);
    if (!scopeId) throw new Error("alert rule scopeId is required");
    if (!name) throw new Error("alert rule name is required");

    const created = await this.db.alertRule.create({
      data: {
        id: trimOrUndefined(input.id),
        organizationId: trimOrUndefined(input.organizationId) ?? null,
        scopeType: input.scopeType,
        scopeId,
        ruleType: input.ruleType,
        name,
        description: trimOrUndefined(input.description) ?? null,
        conditions: input.conditions ?? null,
        channels: Array.isArray(input.channels) ? input.channels : [],
        isActive: input.isActive ?? true
      }
    });

    return mapAlertRule(created);
  }

  async update(input: { id: string; changes: UpdateAlertRuleInput }): Promise<AlertRuleRecord> {
    const updated = await this.db.alertRule.update({
      where: { id: input.id },
      data: {
        ...(input.changes.name !== undefined ? { name: trimOrUndefined(input.changes.name) ?? "" } : {}),
        ...(input.changes.description !== undefined ? { description: trimOrUndefined(input.changes.description) ?? null } : {}),
        ...(input.changes.conditions !== undefined ? { conditions: input.changes.conditions } : {}),
        ...(input.changes.channels !== undefined ? { channels: input.changes.channels } : {}),
        ...(typeof input.changes.isActive === "boolean" ? { isActive: input.changes.isActive } : {}),
        updatedAt: new Date()
      }
    });

    return mapAlertRule(updated);
  }

  async list(input: ListAlertRulesInput = {}): Promise<AlertRuleRecord[]> {
    const rows = await this.db.alertRule.findMany({
      where: {
        ...(input.organizationId !== undefined ? { organizationId: input.organizationId ?? null } : {}),
        ...(input.scopeType ? { scopeType: input.scopeType } : {}),
        ...(trimOrUndefined(input.scopeId) ? { scopeId: trimOrUndefined(input.scopeId) } : {}),
        ...(input.ruleType ? { ruleType: input.ruleType } : {}),
        ...(typeof input.isActive === "boolean" ? { isActive: input.isActive } : {})
      },
      orderBy: { createdAt: "asc" }
    });

    return rows.map(mapAlertRule);
  }

  async listActive(input: Omit<ListAlertRulesInput, "isActive"> = {}): Promise<AlertRuleRecord[]> {
    return this.list({
      ...input,
      isActive: true
    });
  }

  async getById(id: string): Promise<AlertRuleRecord | null> {
    const normalized = trimOrUndefined(id);
    if (!normalized) return null;
    const rules = await this.db.alertRule.findMany({
      orderBy: { createdAt: "desc" }
    });
    const rule = rules.find((item) => item.id === normalized);
    return rule ? mapAlertRule(rule) : null;
  }
}
