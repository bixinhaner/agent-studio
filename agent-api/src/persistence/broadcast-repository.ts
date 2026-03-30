export type BroadcastTargetType = "all_users" | "department" | "role";
export type BroadcastStatus = "draft" | "published" | "archived";

export type BroadcastTargetInput = {
  targetType: BroadcastTargetType;
  targetId?: string | null;
};

export type BroadcastTargetRecord = {
  id: string;
  broadcastId: string;
  targetType: BroadcastTargetType;
  targetId?: string;
  createdAt: string;
};

export type BroadcastDraftInput = {
  title: string;
  bodyMarkdown: string;
  createdByUserId?: string | null;
  dingtalkDeliveryEnabled?: boolean;
  targets?: BroadcastTargetInput[];
};

export type BroadcastUpdateInput = {
  id: string;
  title?: string;
  bodyMarkdown?: string;
  dingtalkDeliveryEnabled?: boolean;
  targets?: BroadcastTargetInput[];
};

export type BroadcastRecord = {
  id: string;
  title: string;
  bodyMarkdown: string;
  status: BroadcastStatus;
  createdByUserId?: string;
  publishedAt?: string;
  publishedByUserId?: string;
  dingtalkDeliveryEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  targets: BroadcastTargetRecord[];
};

type BroadcastMessageRow = {
  id: string;
  title: string;
  bodyMarkdown: string;
  status: string;
  dingtalkDeliveryEnabled: boolean;
  createdByUserId: string | null;
  publishedAt: Date | string | null;
  publishedByUserId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type BroadcastTargetRow = {
  id: string;
  broadcastId: string;
  targetType: string;
  targetId: string | null;
  createdAt: Date | string;
};

type BroadcastTargetLike = {
  id: string;
  broadcastId: string;
  targetType: string;
  targetId: string | null | undefined;
  createdAt: Date | string;
};

type BroadcastMessageTable = {
  findMany(args?: {
    where?: { status?: string };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<BroadcastMessageRow[]>;
  findUnique(args: { where: { id: string } }): Promise<BroadcastMessageRow | null>;
  create(args: { data: Record<string, unknown> }): Promise<BroadcastMessageRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<BroadcastMessageRow>;
};

type BroadcastTargetTable = {
  findMany(args: {
    where: { broadcastId: string };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<BroadcastTargetRow[]>;
  deleteMany(args: { where: { broadcastId: string } }): Promise<{ count: number }>;
  create(args: { data: Record<string, unknown> }): Promise<BroadcastTargetRow>;
};

export type BroadcastRepositoryDb = {
  broadcastMessage: BroadcastMessageTable;
  broadcastTarget: BroadcastTargetTable;
  $transaction<T>(callback: (tx: BroadcastRepositoryDb) => Promise<T>): Promise<T>;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toIsoString(value: Date | string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function normalizeTargetType(value: string): BroadcastTargetType {
  if (value === "department" || value === "role") return value;
  return "all_users";
}

function normalizeTargets(targets: BroadcastTargetInput[] | undefined): BroadcastTargetInput[] {
  const seen = new Set<string>();
  const normalized: BroadcastTargetInput[] = [];
  for (const target of targets ?? []) {
    const targetType = normalizeTargetType(target.targetType);
    const targetId = trimOrUndefined(target.targetId);
    const key = `${targetType}:${targetId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      targetType,
      targetId
    });
  }
  return normalized;
}

function mapBroadcastTarget(row: BroadcastTargetLike): BroadcastTargetRecord {
  return {
    id: row.id,
    broadcastId: row.broadcastId,
    targetType: normalizeTargetType(row.targetType),
    targetId: trimOrUndefined(row.targetId),
    createdAt: toIsoString(row.createdAt) ?? new Date().toISOString()
  };
}

function mapBroadcast(row: BroadcastMessageRow, targets: BroadcastTargetLike[] = []): BroadcastRecord {
  return {
    id: row.id,
    title: row.title,
    bodyMarkdown: row.bodyMarkdown,
    status: row.status as BroadcastStatus,
    createdByUserId: trimOrUndefined(row.createdByUserId),
    publishedAt: toIsoString(row.publishedAt),
    publishedByUserId: trimOrUndefined(row.publishedByUserId),
    dingtalkDeliveryEnabled: Boolean(row.dingtalkDeliveryEnabled),
    createdAt: toIsoString(row.createdAt) ?? new Date().toISOString(),
    updatedAt: toIsoString(row.updatedAt) ?? new Date().toISOString(),
    targets: targets.map(mapBroadcastTarget)
  };
}

function requireDraftTitleAndBody(title: string | undefined, bodyMarkdown: string | undefined): {
  title: string;
  bodyMarkdown: string;
} {
  const normalizedTitle = typeof title === "string" ? title.trim() : "";
  const normalizedBody = typeof bodyMarkdown === "string" ? bodyMarkdown.trim() : "";
  if (!normalizedTitle || !normalizedBody) {
    throw new Error("title and bodyMarkdown are required");
  }
  return { title: normalizedTitle, bodyMarkdown: normalizedBody };
}

export class BroadcastRepository {
  constructor(private readonly db: BroadcastRepositoryDb) {}

  async createDraft(input: BroadcastDraftInput): Promise<BroadcastRecord> {
    const { title, bodyMarkdown } = requireDraftTitleAndBody(input.title, input.bodyMarkdown);
    const now = new Date();
    return this.db.$transaction(async (tx) => {
      const created = await tx.broadcastMessage.create({
        data: {
          title,
          bodyMarkdown,
          status: "draft",
          dingtalkDeliveryEnabled: Boolean(input.dingtalkDeliveryEnabled),
          createdByUserId: trimOrUndefined(input.createdByUserId) ?? null,
          publishedAt: null,
          publishedByUserId: null,
          createdAt: now,
          updatedAt: now
        }
      });
      const targets = await this.replaceTargetsInternal(tx, created.id, input.targets ?? []);
      return mapBroadcast(created, targets);
    });
  }

  async updateDraft(input: BroadcastUpdateInput): Promise<BroadcastRecord> {
    const normalizedId = trimOrUndefined(input.id);
    if (!normalizedId) throw new Error("broadcast id is required");

    return this.db.$transaction(async (tx) => {
      const existing = await tx.broadcastMessage.findUnique({ where: { id: normalizedId } });
      if (!existing) throw new Error("broadcast not found");
      if (existing.status !== "draft") {
        throw new Error("broadcast is not a draft");
      }

      const nextTitle = input.title !== undefined ? input.title.trim() : existing.title;
      const nextBody = input.bodyMarkdown !== undefined ? input.bodyMarkdown.trim() : existing.bodyMarkdown;
      if (!nextTitle || !nextBody) {
        throw new Error("title and bodyMarkdown are required");
      }

      const updated = await tx.broadcastMessage.update({
        where: { id: normalizedId },
        data: {
          title: nextTitle,
          bodyMarkdown: nextBody,
          dingtalkDeliveryEnabled:
            input.dingtalkDeliveryEnabled !== undefined ? Boolean(input.dingtalkDeliveryEnabled) : existing.dingtalkDeliveryEnabled,
          updatedAt: new Date()
        }
      });
      const targets =
        input.targets !== undefined ? await this.replaceTargetsInternal(tx, normalizedId, input.targets) : await tx.broadcastTarget.findMany({
          where: { broadcastId: normalizedId },
          orderBy: { createdAt: "asc" }
        });
      return mapBroadcast(updated, targets);
    });
  }

  async publish(input: { id: string; publishedByUserId?: string | null }): Promise<BroadcastRecord> {
    const normalizedId = trimOrUndefined(input.id);
    if (!normalizedId) throw new Error("broadcast id is required");
    const publishedByUserId = trimOrUndefined(input.publishedByUserId);

    return this.db.$transaction(async (tx) => {
      const existing = await tx.broadcastMessage.findUnique({ where: { id: normalizedId } });
      if (!existing) throw new Error("broadcast not found");
      const targets = await tx.broadcastTarget.findMany({
        where: { broadcastId: normalizedId },
        orderBy: { createdAt: "asc" }
      });
      if (targets.length === 0) {
        throw new Error("broadcast must have at least one target before publish");
      }
      if (existing.status !== "draft") {
        throw new Error("broadcast is not a draft");
      }

      const now = new Date();
      const published = await tx.broadcastMessage.update({
        where: { id: normalizedId },
        data: {
          status: "published",
          publishedAt: now,
          publishedByUserId: publishedByUserId ?? null,
          updatedAt: now
        }
      });
      return mapBroadcast(published, targets);
    });
  }

  async get(id: string): Promise<BroadcastRecord | null> {
    const normalizedId = trimOrUndefined(id);
    if (!normalizedId) return null;
    const [broadcast, targets] = await Promise.all([
      this.db.broadcastMessage.findUnique({ where: { id: normalizedId } }),
      this.db.broadcastTarget.findMany({ where: { broadcastId: normalizedId }, orderBy: { createdAt: "asc" } })
    ]);
    return broadcast ? mapBroadcast(broadcast, targets) : null;
  }

  async list(status?: BroadcastStatus): Promise<BroadcastRecord[]> {
    const rows = await this.db.broadcastMessage.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" }
    });
    const broadcasts = await Promise.all(
      rows.map(async (row) => {
        const targets = await this.db.broadcastTarget.findMany({
          where: { broadcastId: row.id },
          orderBy: { createdAt: "asc" }
        });
        return mapBroadcast(row, targets);
      })
    );
    return broadcasts;
  }

  async listTargets(broadcastId: string): Promise<BroadcastTargetRecord[]> {
    const normalizedId = trimOrUndefined(broadcastId);
    if (!normalizedId) return [];
    const rows = await this.db.broadcastTarget.findMany({
      where: { broadcastId: normalizedId },
      orderBy: { createdAt: "asc" }
    });
    return rows.map(mapBroadcastTarget);
  }

  async replaceTargets(broadcastId: string, targets: BroadcastTargetInput[]): Promise<BroadcastTargetRecord[]> {
    const normalizedId = trimOrUndefined(broadcastId);
    if (!normalizedId) throw new Error("broadcast id is required");
    return this.db
      .$transaction(async (tx) => this.replaceTargetsInternal(tx, normalizedId, targets))
      .then((rows) => rows.map(mapBroadcastTarget));
  }

  private async replaceTargetsInternal(
    tx: BroadcastRepositoryDb,
    broadcastId: string,
    targets: BroadcastTargetInput[]
  ): Promise<BroadcastTargetRow[]> {
    const normalizedTargets = normalizeTargets(targets);
    await tx.broadcastTarget.deleteMany({ where: { broadcastId } });
    const created: BroadcastTargetRow[] = [];
    for (const target of normalizedTargets) {
      created.push(
        await tx.broadcastTarget.create({
          data: {
            broadcastId,
            targetType: target.targetType,
            targetId: target.targetType === "all_users" ? null : trimOrUndefined(target.targetId) ?? null,
            createdAt: new Date()
          }
        })
      );
    }
    return created;
  }
}
