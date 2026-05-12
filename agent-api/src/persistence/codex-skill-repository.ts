export type CodexSkillDraftStatus =
  | "pending_review"
  | "changes_requested"
  | "published"
  | "rejected"
  | "archived";

export type CodexManagedSkillStatus = "active" | "disabled" | "archived";
export type CodexManagedSkillScope = "private" | "agent_mode" | "team" | "org";

export type CodexSkillDraftRecord = {
  id: string;
  organizationId?: string;
  createdByUserId: string;
  createdByDisplayName?: string;
  createdByEmail?: string;
  sourceThreadId?: string;
  sourceManagedSkillId?: string;
  requestedPrompt: string;
  skillName?: string;
  slug: string;
  displayName: string;
  description?: string;
  status: string;
  version: string;
  draftPath: string;
  publishedPath?: string;
  validation?: unknown;
  reviewNote?: string;
  reviewedByUserId?: string;
  reviewedByDisplayName?: string;
  publishedByUserId?: string;
  publishedByDisplayName?: string;
  publishedAt?: string;
  metadata?: unknown;
  createdAt: string;
  updatedAt: string;
};

export type CodexManagedSkillRecord = {
  id: string;
  organizationId?: string;
  ownerUserId?: string;
  scope: string;
  skillName: string;
  slug: string;
  displayName: string;
  description?: string;
  status: string;
  version: string;
  checksum?: string;
  publishedPath: string;
  sourceDraftId?: string;
  createdByUserId?: string;
  createdByDisplayName?: string;
  createdByEmail?: string;
  lastEditedByUserId?: string;
  reviewedByUserId?: string;
  reviewedByDisplayName?: string;
  publishedByUserId?: string;
  publishedByDisplayName?: string;
  metadata?: unknown;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateCodexSkillDraftInput = {
  id?: string;
  organizationId?: string;
  createdByUserId: string;
  createdByDisplayName?: string;
  createdByEmail?: string;
  sourceThreadId?: string;
  sourceManagedSkillId?: string;
  requestedPrompt: string;
  skillName?: string;
  slug: string;
  displayName: string;
  description?: string;
  status?: CodexSkillDraftStatus;
  version?: string;
  draftPath: string;
  validation?: unknown;
  metadata?: unknown;
};

export type UpdateCodexSkillDraftInput = Partial<
  Pick<
    CodexSkillDraftRecord,
    | "skillName"
    | "slug"
    | "displayName"
    | "description"
    | "status"
    | "version"
    | "draftPath"
    | "publishedPath"
    | "validation"
    | "reviewNote"
    | "reviewedByUserId"
    | "reviewedByDisplayName"
    | "publishedByUserId"
    | "publishedByDisplayName"
    | "metadata"
  >
> & {
  publishedAt?: Date | string | null;
};

export type UpsertCodexManagedSkillInput = {
  organizationId?: string;
  ownerUserId?: string;
  scope?: CodexManagedSkillScope;
  skillName: string;
  slug: string;
  displayName: string;
  description?: string;
  status?: CodexManagedSkillStatus;
  version?: string;
  checksum?: string;
  publishedPath: string;
  sourceDraftId?: string;
  createdByUserId?: string;
  createdByDisplayName?: string;
  createdByEmail?: string;
  lastEditedByUserId?: string;
  reviewedByUserId?: string;
  reviewedByDisplayName?: string;
  publishedByUserId?: string;
  publishedByDisplayName?: string;
  metadata?: unknown;
  publishedAt?: Date | string | null;
};

export type UpdateCodexManagedSkillInput = Partial<
  Pick<
    CodexManagedSkillRecord,
    | "ownerUserId"
    | "scope"
    | "slug"
    | "displayName"
    | "description"
    | "status"
    | "version"
    | "checksum"
    | "publishedPath"
    | "sourceDraftId"
    | "createdByUserId"
    | "createdByDisplayName"
    | "createdByEmail"
    | "lastEditedByUserId"
    | "reviewedByUserId"
    | "reviewedByDisplayName"
    | "publishedByUserId"
    | "publishedByDisplayName"
    | "metadata"
  >
> & {
  publishedAt?: Date | string | null;
};

type CodexSkillDraftRow = {
  id: string;
  organizationId: string | null;
  createdByUserId: string;
  createdByDisplayName: string | null;
  createdByEmail: string | null;
  sourceThreadId: string | null;
  sourceManagedSkillId: string | null;
  requestedPrompt: string;
  skillName: string | null;
  slug: string;
  displayName: string;
  description: string | null;
  status: string | null;
  version: string | null;
  draftPath: string;
  publishedPath: string | null;
  validation: unknown;
  reviewNote: string | null;
  reviewedByUserId: string | null;
  reviewedByDisplayName: string | null;
  publishedByUserId: string | null;
  publishedByDisplayName: string | null;
  publishedAt: Date | string | null;
  metadata: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type CodexManagedSkillRow = {
  id: string;
  organizationId: string | null;
  ownerUserId: string | null;
  scope: string | null;
  skillName: string;
  slug: string;
  displayName: string;
  description: string | null;
  status: string | null;
  version: string | null;
  checksum: string | null;
  publishedPath: string;
  sourceDraftId: string | null;
  createdByUserId: string | null;
  createdByDisplayName: string | null;
  createdByEmail: string | null;
  lastEditedByUserId: string | null;
  reviewedByUserId: string | null;
  reviewedByDisplayName: string | null;
  publishedByUserId: string | null;
  publishedByDisplayName: string | null;
  metadata: unknown;
  publishedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type CodexSkillDraftTable = {
  create(args: { data: Record<string, unknown> }): Promise<CodexSkillDraftRow>;
  findUnique(args: { where: { id: string } }): Promise<CodexSkillDraftRow | null>;
  findMany(args?: {
    where?: Record<string, unknown>;
    orderBy?: { createdAt?: "asc" | "desc"; updatedAt?: "asc" | "desc" };
    take?: number;
  }): Promise<CodexSkillDraftRow[]>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<CodexSkillDraftRow>;
};

type CodexManagedSkillTable = {
  create(args: { data: Record<string, unknown> }): Promise<CodexManagedSkillRow>;
  findFirst(args?: { where?: Record<string, unknown> }): Promise<CodexManagedSkillRow | null>;
  findUnique(args: { where: { id: string } }): Promise<CodexManagedSkillRow | null>;
  findMany(args?: {
    where?: Record<string, unknown>;
    orderBy?: { createdAt?: "asc" | "desc"; updatedAt?: "asc" | "desc" };
  }): Promise<CodexManagedSkillRow[]>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<CodexManagedSkillRow>;
};

export type CodexSkillRepositoryDb = {
  codexSkillDraft: CodexSkillDraftTable;
  codexManagedSkill: CodexManagedSkillTable;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toIsoString(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function mapDraft(row: CodexSkillDraftRow): CodexSkillDraftRecord {
  return {
    id: row.id,
    organizationId: trimOrUndefined(row.organizationId),
    createdByUserId: row.createdByUserId,
    createdByDisplayName: trimOrUndefined(row.createdByDisplayName),
    createdByEmail: trimOrUndefined(row.createdByEmail),
    sourceThreadId: trimOrUndefined(row.sourceThreadId),
    sourceManagedSkillId: trimOrUndefined(row.sourceManagedSkillId),
    requestedPrompt: row.requestedPrompt,
    skillName: trimOrUndefined(row.skillName),
    slug: row.slug,
    displayName: row.displayName,
    description: trimOrUndefined(row.description),
    status: trimOrUndefined(row.status) ?? "pending_review",
    version: trimOrUndefined(row.version) ?? "1.0.0",
    draftPath: row.draftPath,
    publishedPath: trimOrUndefined(row.publishedPath),
    validation: row.validation ?? undefined,
    reviewNote: trimOrUndefined(row.reviewNote),
    reviewedByUserId: trimOrUndefined(row.reviewedByUserId),
    reviewedByDisplayName: trimOrUndefined(row.reviewedByDisplayName),
    publishedByUserId: trimOrUndefined(row.publishedByUserId),
    publishedByDisplayName: trimOrUndefined(row.publishedByDisplayName),
    publishedAt: toIsoString(row.publishedAt),
    metadata: row.metadata ?? undefined,
    createdAt: toIsoString(row.createdAt) ?? new Date().toISOString(),
    updatedAt: toIsoString(row.updatedAt) ?? new Date().toISOString()
  };
}

function mapManagedSkill(row: CodexManagedSkillRow): CodexManagedSkillRecord {
  return {
    id: row.id,
    organizationId: trimOrUndefined(row.organizationId),
    ownerUserId: trimOrUndefined(row.ownerUserId),
    scope: trimOrUndefined(row.scope) ?? "agent_mode",
    skillName: row.skillName,
    slug: row.slug,
    displayName: row.displayName,
    description: trimOrUndefined(row.description),
    status: trimOrUndefined(row.status) ?? "active",
    version: trimOrUndefined(row.version) ?? "1.0.0",
    checksum: trimOrUndefined(row.checksum),
    publishedPath: row.publishedPath,
    sourceDraftId: trimOrUndefined(row.sourceDraftId),
    createdByUserId: trimOrUndefined(row.createdByUserId),
    createdByDisplayName: trimOrUndefined(row.createdByDisplayName),
    createdByEmail: trimOrUndefined(row.createdByEmail),
    lastEditedByUserId: trimOrUndefined(row.lastEditedByUserId),
    reviewedByUserId: trimOrUndefined(row.reviewedByUserId),
    reviewedByDisplayName: trimOrUndefined(row.reviewedByDisplayName),
    publishedByUserId: trimOrUndefined(row.publishedByUserId),
    publishedByDisplayName: trimOrUndefined(row.publishedByDisplayName),
    metadata: row.metadata ?? undefined,
    publishedAt: toIsoString(row.publishedAt),
    createdAt: toIsoString(row.createdAt) ?? new Date().toISOString(),
    updatedAt: toIsoString(row.updatedAt) ?? new Date().toISOString()
  };
}

export class CodexSkillRepository {
  constructor(private readonly db: CodexSkillRepositoryDb) {}

  async createDraft(input: CreateCodexSkillDraftInput): Promise<CodexSkillDraftRecord> {
    const createdByUserId = trimOrUndefined(input.createdByUserId);
    if (!createdByUserId) throw new Error("createdByUserId is required");
    const created = await this.db.codexSkillDraft.create({
      data: {
        id: trimOrUndefined(input.id),
        organizationId: trimOrUndefined(input.organizationId) ?? null,
        createdByUserId,
        createdByDisplayName: trimOrUndefined(input.createdByDisplayName) ?? null,
        createdByEmail: trimOrUndefined(input.createdByEmail) ?? null,
        sourceThreadId: trimOrUndefined(input.sourceThreadId) ?? null,
        sourceManagedSkillId: trimOrUndefined(input.sourceManagedSkillId) ?? null,
        requestedPrompt: input.requestedPrompt,
        skillName: trimOrUndefined(input.skillName) ?? null,
        slug: input.slug,
        displayName: input.displayName,
        description: trimOrUndefined(input.description) ?? null,
        status: trimOrUndefined(input.status) ?? "pending_review",
        version: trimOrUndefined(input.version) ?? "1.0.0",
        draftPath: input.draftPath,
        validation: input.validation ?? null,
        metadata: input.metadata ?? null
      }
    });
    return mapDraft(created);
  }

  async getDraft(id: string): Promise<CodexSkillDraftRecord | undefined> {
    const draftId = trimOrUndefined(id);
    if (!draftId) return undefined;
    const row = await this.db.codexSkillDraft.findUnique({ where: { id: draftId } });
    return row ? mapDraft(row) : undefined;
  }

  async listDrafts(input?: {
    organizationId?: string;
    createdByUserId?: string;
    status?: string;
    take?: number;
  }): Promise<CodexSkillDraftRecord[]> {
    const where: Record<string, unknown> = {};
    const organizationId = trimOrUndefined(input?.organizationId);
    if (organizationId) where.organizationId = organizationId;
    const createdByUserId = trimOrUndefined(input?.createdByUserId);
    if (createdByUserId) where.createdByUserId = createdByUserId;
    const status = trimOrUndefined(input?.status);
    if (status) where.status = status;
    const rows = await this.db.codexSkillDraft.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      orderBy: { createdAt: "desc" },
      take: input?.take
    });
    return rows.map(mapDraft);
  }

  async updateDraft(id: string, input: UpdateCodexSkillDraftInput): Promise<CodexSkillDraftRecord> {
    const draftId = trimOrUndefined(id);
    if (!draftId) throw new Error("skill draft 不存在");
    const row = await this.db.codexSkillDraft.update({
      where: { id: draftId },
      data: {
        ...(input.skillName !== undefined ? { skillName: trimOrUndefined(input.skillName) ?? null } : {}),
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.description !== undefined ? { description: trimOrUndefined(input.description) ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.version !== undefined ? { version: input.version } : {}),
        ...(input.draftPath !== undefined ? { draftPath: input.draftPath } : {}),
        ...(input.publishedPath !== undefined ? { publishedPath: trimOrUndefined(input.publishedPath) ?? null } : {}),
        ...(input.validation !== undefined ? { validation: input.validation ?? null } : {}),
        ...(input.reviewNote !== undefined ? { reviewNote: trimOrUndefined(input.reviewNote) ?? null } : {}),
        ...(input.reviewedByUserId !== undefined ? { reviewedByUserId: trimOrUndefined(input.reviewedByUserId) ?? null } : {}),
        ...(input.reviewedByDisplayName !== undefined
          ? { reviewedByDisplayName: trimOrUndefined(input.reviewedByDisplayName) ?? null }
          : {}),
        ...(input.publishedByUserId !== undefined ? { publishedByUserId: trimOrUndefined(input.publishedByUserId) ?? null } : {}),
        ...(input.publishedByDisplayName !== undefined
          ? { publishedByDisplayName: trimOrUndefined(input.publishedByDisplayName) ?? null }
          : {}),
        ...(input.publishedAt !== undefined ? { publishedAt: input.publishedAt ? new Date(input.publishedAt) : null } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata ?? null } : {}),
        updatedAt: new Date()
      }
    });
    return mapDraft(row);
  }

  async listManagedSkills(input?: {
    organizationId?: string;
    status?: string;
    scope?: string;
    ownerUserId?: string;
    skillName?: string;
  }): Promise<CodexManagedSkillRecord[]> {
    const where: Record<string, unknown> = {};
    const organizationId = trimOrUndefined(input?.organizationId);
    if (organizationId) where.organizationId = organizationId;
    const status = trimOrUndefined(input?.status);
    if (status) where.status = status;
    const scope = trimOrUndefined(input?.scope);
    if (scope) where.scope = scope;
    const ownerUserId = trimOrUndefined(input?.ownerUserId);
    if (ownerUserId) where.ownerUserId = ownerUserId;
    const skillName = trimOrUndefined(input?.skillName);
    if (skillName) where.skillName = skillName;
    const rows = await this.db.codexManagedSkill.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      orderBy: { updatedAt: "desc" }
    });
    return rows.map(mapManagedSkill);
  }

  async getManagedSkill(id: string): Promise<CodexManagedSkillRecord | undefined> {
    const skillId = trimOrUndefined(id);
    if (!skillId) return undefined;
    const row = await this.db.codexManagedSkill.findUnique({ where: { id: skillId } });
    return row ? mapManagedSkill(row) : undefined;
  }

  async findManagedSkillByName(input: {
    organizationId?: string;
    ownerUserId?: string;
    scope?: string;
    skillName: string;
  }): Promise<CodexManagedSkillRecord | undefined> {
    const skillName = trimOrUndefined(input.skillName);
    if (!skillName) return undefined;
    const row = await this.db.codexManagedSkill.findFirst({
      where: {
        skillName,
        organizationId: trimOrUndefined(input.organizationId) ?? null,
        ownerUserId: trimOrUndefined(input.ownerUserId) ?? null,
        scope: trimOrUndefined(input.scope) ?? "agent_mode"
      }
    });
    return row ? mapManagedSkill(row) : undefined;
  }

  async updateManagedSkill(id: string, input: UpdateCodexManagedSkillInput): Promise<CodexManagedSkillRecord> {
    const skillId = trimOrUndefined(id);
    if (!skillId) throw new Error("managed skill 不存在");
    const row = await this.db.codexManagedSkill.update({
      where: { id: skillId },
      data: {
        ...(input.ownerUserId !== undefined ? { ownerUserId: trimOrUndefined(input.ownerUserId) ?? null } : {}),
        ...(input.scope !== undefined ? { scope: trimOrUndefined(input.scope) ?? "agent_mode" } : {}),
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.description !== undefined ? { description: trimOrUndefined(input.description) ?? null } : {}),
        ...(input.status !== undefined ? { status: trimOrUndefined(input.status) ?? "active" } : {}),
        ...(input.version !== undefined ? { version: trimOrUndefined(input.version) ?? "1.0.0" } : {}),
        ...(input.checksum !== undefined ? { checksum: trimOrUndefined(input.checksum) ?? null } : {}),
        ...(input.publishedPath !== undefined ? { publishedPath: input.publishedPath } : {}),
        ...(input.sourceDraftId !== undefined ? { sourceDraftId: trimOrUndefined(input.sourceDraftId) ?? null } : {}),
        ...(input.createdByUserId !== undefined ? { createdByUserId: trimOrUndefined(input.createdByUserId) ?? null } : {}),
        ...(input.createdByDisplayName !== undefined
          ? { createdByDisplayName: trimOrUndefined(input.createdByDisplayName) ?? null }
          : {}),
        ...(input.createdByEmail !== undefined ? { createdByEmail: trimOrUndefined(input.createdByEmail) ?? null } : {}),
        ...(input.lastEditedByUserId !== undefined
          ? { lastEditedByUserId: trimOrUndefined(input.lastEditedByUserId) ?? null }
          : {}),
        ...(input.reviewedByUserId !== undefined ? { reviewedByUserId: trimOrUndefined(input.reviewedByUserId) ?? null } : {}),
        ...(input.reviewedByDisplayName !== undefined
          ? { reviewedByDisplayName: trimOrUndefined(input.reviewedByDisplayName) ?? null }
          : {}),
        ...(input.publishedByUserId !== undefined
          ? { publishedByUserId: trimOrUndefined(input.publishedByUserId) ?? null }
          : {}),
        ...(input.publishedByDisplayName !== undefined
          ? { publishedByDisplayName: trimOrUndefined(input.publishedByDisplayName) ?? null }
          : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata ?? null } : {}),
        ...(input.publishedAt !== undefined ? { publishedAt: input.publishedAt ? new Date(input.publishedAt) : null } : {}),
        updatedAt: new Date()
      }
    });
    return mapManagedSkill(row);
  }

  async upsertManagedSkill(input: UpsertCodexManagedSkillInput): Promise<CodexManagedSkillRecord> {
    const skillName = trimOrUndefined(input.skillName);
    if (!skillName) throw new Error("skillName is required");
    const organizationId = trimOrUndefined(input.organizationId);
    const ownerUserId = trimOrUndefined(input.ownerUserId);
    const scope = trimOrUndefined(input.scope) ?? "agent_mode";
    const existing = await this.db.codexManagedSkill.findFirst({
      where: {
        organizationId: organizationId ?? null,
        ownerUserId: ownerUserId ?? null,
        scope,
        skillName
      }
    });
    const data = {
      organizationId: organizationId ?? null,
      ownerUserId: ownerUserId ?? null,
      scope,
      skillName,
      slug: input.slug,
      displayName: input.displayName,
      description: trimOrUndefined(input.description) ?? null,
      status: trimOrUndefined(input.status) ?? "active",
      version: trimOrUndefined(input.version) ?? "1.0.0",
      checksum: trimOrUndefined(input.checksum) ?? null,
      publishedPath: input.publishedPath,
      sourceDraftId: trimOrUndefined(input.sourceDraftId) ?? null,
      createdByUserId: trimOrUndefined(input.createdByUserId) ?? null,
      createdByDisplayName: trimOrUndefined(input.createdByDisplayName) ?? null,
      createdByEmail: trimOrUndefined(input.createdByEmail) ?? null,
      lastEditedByUserId: trimOrUndefined(input.lastEditedByUserId) ?? null,
      reviewedByUserId: trimOrUndefined(input.reviewedByUserId) ?? null,
      reviewedByDisplayName: trimOrUndefined(input.reviewedByDisplayName) ?? null,
      publishedByUserId: trimOrUndefined(input.publishedByUserId) ?? null,
      publishedByDisplayName: trimOrUndefined(input.publishedByDisplayName) ?? null,
      metadata: input.metadata ?? null,
      publishedAt: input.publishedAt ? new Date(input.publishedAt) : new Date(),
      updatedAt: new Date()
    };
    const row = existing
      ? await this.db.codexManagedSkill.update({
          where: { id: existing.id },
          data
        })
      : await this.db.codexManagedSkill.create({
          data
        });
    return mapManagedSkill(row);
  }
}
