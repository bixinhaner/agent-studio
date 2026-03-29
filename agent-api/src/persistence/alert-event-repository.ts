export type AlertSeverity = "info" | "warning" | "critical";
export type AlertStatus = "open" | "acknowledged" | "resolved";

export type AlertEventRecord = {
  id: string;
  organizationId?: string;
  alertRuleId?: string;
  scopeType: string;
  scopeId: string;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  detail: string;
  payload?: unknown;
  createdAt: string;
  updatedAt: string;
};

export type CreateAlertEventInput = {
  id?: string;
  organizationId?: string;
  alertRuleId?: string;
  scopeType: string;
  scopeId: string;
  severity: AlertSeverity;
  status?: AlertStatus;
  title: string;
  detail: string;
  payload?: unknown;
};

export type UpdateAlertEventInput = {
  status?: AlertStatus;
  severity?: AlertSeverity;
  title?: string;
  detail?: string;
  payload?: unknown;
};

export type ListAlertEventsInput = {
  organizationId?: string | null;
  alertRuleId?: string | null;
  scopeType?: string;
  scopeId?: string;
  severity?: AlertSeverity;
  status?: AlertStatus;
  take?: number;
};

type AlertEventRow = {
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
  createdAt: Date | string;
  updatedAt: Date | string;
};

type AlertEventTable = {
  create(args: { data: Record<string, unknown> }): Promise<AlertEventRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<AlertEventRow>;
  findMany(args?: {
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
  }): Promise<AlertEventRow[]>;
};

export type AlertEventRepositoryDb = {
  alertEvent: AlertEventTable;
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

function mapAlertEvent(row: AlertEventRow): AlertEventRecord {
  return {
    id: row.id,
    organizationId: trimOrUndefined(row.organizationId),
    alertRuleId: trimOrUndefined(row.alertRuleId),
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    severity: row.severity as AlertSeverity,
    status: row.status as AlertStatus,
    title: row.title,
    detail: row.detail,
    payload: row.payload ?? undefined,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

export class AlertEventRepository {
  constructor(private readonly db: AlertEventRepositoryDb) {}

  async create(input: CreateAlertEventInput): Promise<AlertEventRecord> {
    const scopeType = trimOrUndefined(input.scopeType);
    const scopeId = trimOrUndefined(input.scopeId);
    const title = trimOrUndefined(input.title);
    const detail = trimOrUndefined(input.detail);
    if (!scopeType || !scopeId || !title || !detail) {
      throw new Error("alert event scopeType, scopeId, title, and detail are required");
    }

    const created = await this.db.alertEvent.create({
      data: {
        id: trimOrUndefined(input.id),
        organizationId: trimOrUndefined(input.organizationId) ?? null,
        alertRuleId: trimOrUndefined(input.alertRuleId) ?? null,
        scopeType,
        scopeId,
        severity: input.severity,
        status: input.status ?? "open",
        title,
        detail,
        payload: input.payload ?? null
      }
    });

    return mapAlertEvent(created);
  }

  async update(input: { id: string; changes: UpdateAlertEventInput }): Promise<AlertEventRecord> {
    const updated = await this.db.alertEvent.update({
      where: { id: trimOrUndefined(input.id) ?? input.id },
      data: {
        ...(input.changes.status !== undefined ? { status: input.changes.status } : {}),
        ...(input.changes.severity !== undefined ? { severity: input.changes.severity } : {}),
        ...(input.changes.title !== undefined ? { title: trimOrUndefined(input.changes.title) ?? "" } : {}),
        ...(input.changes.detail !== undefined ? { detail: trimOrUndefined(input.changes.detail) ?? "" } : {}),
        ...(input.changes.payload !== undefined ? { payload: input.changes.payload } : {}),
        updatedAt: new Date()
      }
    });

    return mapAlertEvent(updated);
  }

  async list(input: ListAlertEventsInput = {}): Promise<AlertEventRecord[]> {
    const rows = await this.db.alertEvent.findMany({
      where: {
        ...(input.organizationId !== undefined ? { organizationId: input.organizationId ?? null } : {}),
        ...(input.alertRuleId !== undefined ? { alertRuleId: input.alertRuleId ?? null } : {}),
        ...(input.scopeType ? { scopeType: input.scopeType } : {}),
        ...(trimOrUndefined(input.scopeId) ? { scopeId: trimOrUndefined(input.scopeId) } : {}),
        ...(input.severity ? { severity: input.severity } : {}),
        ...(input.status ? { status: input.status } : {})
      },
      orderBy: { createdAt: "desc" },
      take: input.take
    });

    return rows.map(mapAlertEvent);
  }
}
