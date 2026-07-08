export type BroadcastTargetType = "all_users" | "department" | "role";
export type BroadcastStatus = "draft" | "published" | "archived";
export type BroadcastTestStatus = "not_tested" | "passed" | "failed" | "stale";

export type BroadcastChannels = {
  email: boolean;
  inApp: boolean;
  dingtalk: boolean;
};

export type BroadcastContent = {
  subject: string;
  bodyMarkdown: string;
  ctaLabel?: string;
  ctaUrl?: string;
  language: "zh" | "en";
};

export type BroadcastAudienceRule = {
  type:
    | "all_users"
    | "organization_type"
    | "organization"
    | "department"
    | "user"
    | "role"
    | "disabled_users"
    | "missing_email"
    | "email_opt_out";
  id?: string;
  value?: string;
  includeChildren?: boolean;
};

export type BroadcastAudienceConfig = {
  include: BroadcastAudienceRule[];
  exclude: BroadcastAudienceRule[];
};

export type BroadcastAudienceSnapshot = {
  recipientCount: number;
  emailReachableCount: number;
  internalCount: number;
  externalCount: number;
  excludedCount: number;
  sampleRecipients: Array<{
    userId: string;
    displayName?: string;
    email?: string;
    organizationName?: string;
    organizationType?: string;
  }>;
  calculatedAt: string;
};

export type BroadcastDeliverySummary = {
  recipientCount: number;
  emailSent: number;
  emailFailed: number;
  inAppSent: number;
  dingtalkSent: number;
  lastPublishedAt?: string;
};

export type BroadcastTestState = {
  status: BroadcastTestStatus;
  lastTestedAt?: string;
  lastFingerprint?: string;
};

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
  channelEmailEnabled?: boolean;
  channelInAppEnabled?: boolean;
  content?: Partial<BroadcastContent>;
  audience?: BroadcastAudienceConfig;
  targets?: BroadcastTargetInput[];
};

export type BroadcastUpdateInput = {
  id: string;
  title?: string;
  bodyMarkdown?: string;
  dingtalkDeliveryEnabled?: boolean;
  channelEmailEnabled?: boolean;
  channelInAppEnabled?: boolean;
  content?: Partial<BroadcastContent>;
  audience?: BroadcastAudienceConfig;
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
  channelEmailEnabled: boolean;
  channelInAppEnabled: boolean;
  channels: BroadcastChannels;
  content: BroadcastContent;
  audience: BroadcastAudienceConfig;
  audienceSnapshot?: BroadcastAudienceSnapshot;
  deliverySummary?: BroadcastDeliverySummary;
  testState: BroadcastTestState;
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
  channelEmailEnabled?: boolean;
  channelInAppEnabled?: boolean;
  contentJson?: unknown;
  audienceJson?: unknown;
  audienceSnapshotJson?: unknown;
  deliverySummaryJson?: unknown;
  lastTestedAt?: Date | string | null;
  lastTestStatus?: string;
  lastTestFingerprint?: string | null;
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function normalizeLanguage(value: unknown): "zh" | "en" {
  return value === "en" ? "en" : "zh";
}

function normalizeTestStatus(value: unknown): BroadcastTestStatus {
  return value === "passed" || value === "failed" || value === "stale" ? value : "not_tested";
}

function assertBroadcastTargetType(value: string): BroadcastTargetType {
  if (value === "all_users" || value === "department" || value === "role") return value;
  throw new Error("broadcast targetType must be all_users, department, or role");
}

function requireBroadcastTargetId(targetType: BroadcastTargetType, targetId: string | null | undefined): string | undefined {
  if (targetType === "all_users") {
    return undefined;
  }
  const trimmed = trimOrUndefined(targetId);
  if (!trimmed) {
    throw new Error(`broadcast targets of type ${targetType} require targetId`);
  }
  return trimmed;
}

function normalizeTargets(targets: BroadcastTargetInput[] | undefined): BroadcastTargetInput[] {
  const seen = new Set<string>();
  const normalized: BroadcastTargetInput[] = [];
  for (const target of targets ?? []) {
    const targetType = assertBroadcastTargetType(target.targetType);
    const targetId = requireBroadcastTargetId(targetType, target.targetId);
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
  const targetType = assertBroadcastTargetType(row.targetType);
  return {
    id: row.id,
    broadcastId: row.broadcastId,
    targetType,
    targetId: targetType === "all_users" ? undefined : requireBroadcastTargetId(targetType, row.targetId),
    createdAt: toIsoString(row.createdAt) ?? new Date().toISOString()
  };
}

function normalizeAudienceRule(value: unknown): BroadcastAudienceRule | undefined {
  const record = asRecord(value);
  const type = asString(record.type);
  if (
    type !== "all_users" &&
    type !== "organization_type" &&
    type !== "organization" &&
    type !== "department" &&
    type !== "user" &&
    type !== "role" &&
    type !== "disabled_users" &&
    type !== "missing_email" &&
    type !== "email_opt_out"
  ) {
    return undefined;
  }
  return {
    type,
    id: asString(record.id),
    value: asString(record.value),
    includeChildren: asBoolean(record.includeChildren)
  };
}

function normalizeAudience(value: unknown, targets: BroadcastTargetLike[]): BroadcastAudienceConfig {
  const record = asRecord(value);
  const include = Array.isArray(record.include)
    ? record.include.map(normalizeAudienceRule).filter((rule): rule is BroadcastAudienceRule => Boolean(rule))
    : [];
  const exclude = Array.isArray(record.exclude)
    ? record.exclude.map(normalizeAudienceRule).filter((rule): rule is BroadcastAudienceRule => Boolean(rule))
    : [];

  if (include.length || exclude.length) {
    return { include, exclude };
  }

  return {
    include: targets.map((target) => ({
      type: assertBroadcastTargetType(target.targetType) === "all_users" ? "all_users" : assertBroadcastTargetType(target.targetType),
      id: target.targetId ?? undefined
    })),
    exclude: [
      { type: "disabled_users" },
      { type: "missing_email" },
      { type: "email_opt_out" }
    ]
  };
}

function normalizeContent(value: unknown, fallback: { title: string; bodyMarkdown: string }): BroadcastContent {
  const record = asRecord(value);
  return {
    subject: asString(record.subject) ?? fallback.title,
    bodyMarkdown: asString(record.bodyMarkdown) ?? fallback.bodyMarkdown,
    ctaLabel: asString(record.ctaLabel),
    ctaUrl: asString(record.ctaUrl),
    language: normalizeLanguage(record.language)
  };
}

function normalizeAudienceSnapshot(value: unknown): BroadcastAudienceSnapshot | undefined {
  const record = asRecord(value);
  const recipientCount = Number(record.recipientCount);
  if (!Number.isFinite(recipientCount)) return undefined;
  return {
    recipientCount,
    emailReachableCount: Number(record.emailReachableCount) || 0,
    internalCount: Number(record.internalCount) || 0,
    externalCount: Number(record.externalCount) || 0,
    excludedCount: Number(record.excludedCount) || 0,
    sampleRecipients: Array.isArray(record.sampleRecipients)
      ? record.sampleRecipients.slice(0, 20).map((item) => {
          const recipient = asRecord(item);
          return {
            userId: asString(recipient.userId) ?? "",
            displayName: asString(recipient.displayName),
            email: asString(recipient.email),
            organizationName: asString(recipient.organizationName),
            organizationType: asString(recipient.organizationType)
          };
        }).filter((item) => item.userId)
      : [],
    calculatedAt: asString(record.calculatedAt) ?? new Date().toISOString()
  };
}

function normalizeDeliverySummary(value: unknown): BroadcastDeliverySummary | undefined {
  const record = asRecord(value);
  const recipientCount = Number(record.recipientCount);
  if (!Number.isFinite(recipientCount)) return undefined;
  return {
    recipientCount,
    emailSent: Number(record.emailSent) || 0,
    emailFailed: Number(record.emailFailed) || 0,
    inAppSent: Number(record.inAppSent) || 0,
    dingtalkSent: Number(record.dingtalkSent) || 0,
    lastPublishedAt: asString(record.lastPublishedAt)
  };
}

function serializeContent(input: Partial<BroadcastContent> | undefined, fallback: { title: string; bodyMarkdown: string }): BroadcastContent {
  return normalizeContent(input ?? {}, fallback);
}

function serializeAudience(input: BroadcastAudienceConfig | undefined, targets: BroadcastTargetInput[] | undefined): BroadcastAudienceConfig {
  if (input) {
    return {
      include: input.include.map(normalizeAudienceRule).filter((rule): rule is BroadcastAudienceRule => Boolean(rule)),
      exclude: input.exclude.map(normalizeAudienceRule).filter((rule): rule is BroadcastAudienceRule => Boolean(rule))
    };
  }
  return {
    include: normalizeTargets(targets).map((target) => ({
      type: target.targetType === "all_users" ? "all_users" : target.targetType,
      id: target.targetId ?? undefined
    })),
    exclude: [
      { type: "disabled_users" },
      { type: "missing_email" },
      { type: "email_opt_out" }
    ]
  };
}

function mapBroadcast(row: BroadcastMessageRow, targets: BroadcastTargetLike[] = []): BroadcastRecord {
  const channelEmailEnabled = Boolean(row.channelEmailEnabled);
  const channelInAppEnabled = row.channelInAppEnabled !== false;
  const dingtalkDeliveryEnabled = Boolean(row.dingtalkDeliveryEnabled);
  const content = normalizeContent(row.contentJson, { title: row.title, bodyMarkdown: row.bodyMarkdown });
  const audience = normalizeAudience(row.audienceJson, targets);
  return {
    id: row.id,
    title: row.title,
    bodyMarkdown: row.bodyMarkdown,
    status: row.status as BroadcastStatus,
    createdByUserId: trimOrUndefined(row.createdByUserId),
    publishedAt: toIsoString(row.publishedAt),
    publishedByUserId: trimOrUndefined(row.publishedByUserId),
    dingtalkDeliveryEnabled,
    channelEmailEnabled,
    channelInAppEnabled,
    channels: {
      email: channelEmailEnabled,
      inApp: channelInAppEnabled,
      dingtalk: dingtalkDeliveryEnabled
    },
    content,
    audience,
    audienceSnapshot: normalizeAudienceSnapshot(row.audienceSnapshotJson),
    deliverySummary: normalizeDeliverySummary(row.deliverySummaryJson),
    testState: {
      status: normalizeTestStatus(row.lastTestStatus),
      lastTestedAt: toIsoString(row.lastTestedAt),
      lastFingerprint: trimOrUndefined(row.lastTestFingerprint)
    },
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
    const channels = {
      email: Boolean(input.channelEmailEnabled),
      inApp: input.channelInAppEnabled !== false,
      dingtalk: Boolean(input.dingtalkDeliveryEnabled)
    };
    const content = serializeContent(input.content, { title, bodyMarkdown });
    const audience = serializeAudience(input.audience, input.targets);
    const now = new Date();
    return this.db.$transaction(async (tx) => {
      const created = await tx.broadcastMessage.create({
        data: {
          title,
          bodyMarkdown,
          status: "draft",
          dingtalkDeliveryEnabled: channels.dingtalk,
          channelEmailEnabled: channels.email,
          channelInAppEnabled: channels.inApp,
          contentJson: content,
          audienceJson: audience,
          audienceSnapshotJson: null,
          deliverySummaryJson: null,
          lastTestedAt: null,
          lastTestStatus: "not_tested",
          lastTestFingerprint: null,
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
      const existingContent = normalizeContent(existing.contentJson, {
        title: existing.title,
        bodyMarkdown: existing.bodyMarkdown
      });
      const content = serializeContent({ ...existingContent, ...(input.content ?? {}) }, { title: nextTitle, bodyMarkdown: nextBody });
      const existingTargets = await tx.broadcastTarget.findMany({
          where: { broadcastId: normalizedId },
          orderBy: { createdAt: "asc" }
        });
      const audience =
        input.audience !== undefined
          ? serializeAudience(input.audience, input.targets)
          : input.targets !== undefined
            ? serializeAudience(undefined, input.targets)
            : normalizeAudience(existing.audienceJson, existingTargets);

      const updated = await tx.broadcastMessage.update({
        where: { id: normalizedId },
        data: {
          title: nextTitle,
          bodyMarkdown: nextBody,
          dingtalkDeliveryEnabled:
            input.dingtalkDeliveryEnabled !== undefined ? Boolean(input.dingtalkDeliveryEnabled) : existing.dingtalkDeliveryEnabled,
          channelEmailEnabled:
            input.channelEmailEnabled !== undefined ? Boolean(input.channelEmailEnabled) : Boolean(existing.channelEmailEnabled),
          channelInAppEnabled:
            input.channelInAppEnabled !== undefined ? Boolean(input.channelInAppEnabled) : existing.channelInAppEnabled !== false,
          contentJson: content,
          audienceJson: audience,
          lastTestStatus: "stale",
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

  async markTested(input: {
    id: string;
    status: BroadcastTestStatus;
    fingerprint?: string | null;
    testedAt?: Date;
  }): Promise<BroadcastRecord> {
    const normalizedId = trimOrUndefined(input.id);
    if (!normalizedId) throw new Error("broadcast id is required");
    const updated = await this.db.broadcastMessage.update({
      where: { id: normalizedId },
      data: {
        lastTestStatus: input.status,
        lastTestedAt: input.testedAt ?? new Date(),
        lastTestFingerprint: trimOrUndefined(input.fingerprint) ?? null,
        updatedAt: new Date()
      }
    });
    const targets = await this.db.broadcastTarget.findMany({ where: { broadcastId: normalizedId }, orderBy: { createdAt: "asc" } });
    return mapBroadcast(updated, targets);
  }

  async updateAudienceSnapshot(input: { id: string; snapshot: BroadcastAudienceSnapshot }): Promise<BroadcastRecord> {
    const normalizedId = trimOrUndefined(input.id);
    if (!normalizedId) throw new Error("broadcast id is required");
    const updated = await this.db.broadcastMessage.update({
      where: { id: normalizedId },
      data: {
        audienceSnapshotJson: input.snapshot,
        updatedAt: new Date()
      }
    });
    const targets = await this.db.broadcastTarget.findMany({ where: { broadcastId: normalizedId }, orderBy: { createdAt: "asc" } });
    return mapBroadcast(updated, targets);
  }

  async updateDeliverySummary(input: { id: string; summary: BroadcastDeliverySummary }): Promise<BroadcastRecord> {
    const normalizedId = trimOrUndefined(input.id);
    if (!normalizedId) throw new Error("broadcast id is required");
    const updated = await this.db.broadcastMessage.update({
      where: { id: normalizedId },
      data: {
        deliverySummaryJson: input.summary,
        updatedAt: new Date()
      }
    });
    const targets = await this.db.broadcastTarget.findMany({ where: { broadcastId: normalizedId }, orderBy: { createdAt: "asc" } });
    return mapBroadcast(updated, targets);
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
      const audience = normalizeAudience(existing.audienceJson, targets);
      if (targets.length === 0 && audience.include.length === 0) {
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
