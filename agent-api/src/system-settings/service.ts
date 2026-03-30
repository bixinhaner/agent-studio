import { systemSettingsPayloadPatchSchema, type SystemSettingsPayloadPatch, type SystemSettingsVersionRecord } from "./types.js";

type SystemSettingsRepositoryLike = {
  getOrCreateDraft(): Promise<SystemSettingsVersionRecord>;
  saveDraft(patch: SystemSettingsPayloadPatch): Promise<SystemSettingsVersionRecord>;
  publishDraft(input: { publishedByUserId: string }): Promise<SystemSettingsVersionRecord>;
  getCurrentPublished(): Promise<SystemSettingsVersionRecord | undefined>;
};

type SystemSettingsAuditLogLike = {
  create(input: {
    actorUserId?: string;
    actionType: string;
    targetType: string;
    targetId?: string;
    beforePayload?: unknown;
    afterPayload?: unknown;
    metadata?: unknown;
  }): Promise<unknown>;
};

export type SystemSettingsVersionMeta = {
  id: string;
  versionNumber: number;
  revision: number;
  status: SystemSettingsVersionRecord["status"];
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  publishedByUserId?: string;
};

export type SystemSettingsState = {
  draft: SystemSettingsVersionRecord;
  published: SystemSettingsVersionRecord | null;
  draftMeta: SystemSettingsVersionMeta;
  publishedMeta: SystemSettingsVersionMeta | null;
};

export type SystemSettingsServiceDependencies = {
  repository: SystemSettingsRepositoryLike;
  audits?: SystemSettingsAuditLogLike;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function buildMeta(record: SystemSettingsVersionRecord): SystemSettingsVersionMeta {
  return {
    id: record.id,
    versionNumber: record.versionNumber,
    revision: record.revision,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    publishedAt: record.publishedAt,
    publishedByUserId: record.publishedByUserId
  };
}

function buildAuditMetadata(input: {
  kind: "draft_update" | "publish";
  draft: SystemSettingsVersionRecord;
  published?: SystemSettingsVersionRecord;
  patch?: SystemSettingsPayloadPatch;
  actorUserId: string;
}): Record<string, unknown> {
  if (input.kind === "draft_update") {
    return {
      kind: input.kind,
      versionNumber: input.draft.versionNumber,
      revision: input.draft.revision,
      changedSections: Object.keys(input.patch ?? {})
    };
  }

  return {
    kind: input.kind,
    draftVersionNumber: input.draft.versionNumber,
    publishedVersionNumber: input.published?.versionNumber,
    publishedByUserId: input.actorUserId
  };
}

export class SystemSettingsService {
  constructor(private readonly dependencies: SystemSettingsServiceDependencies) {}

  async read(): Promise<SystemSettingsState> {
    const [draft, published] = await Promise.all([
      this.dependencies.repository.getOrCreateDraft(),
      this.dependencies.repository.getCurrentPublished()
    ]);

    return {
      draft,
      published: published ?? null,
      draftMeta: buildMeta(draft),
      publishedMeta: published ? buildMeta(published) : null
    };
  }

  async updateDraft(input: { actorUserId: string; patch: SystemSettingsPayloadPatch }): Promise<SystemSettingsState> {
    const actorUserId = trimOrUndefined(input.actorUserId);
    if (!actorUserId) {
      throw new Error("actorUserId is required");
    }
    const patch = systemSettingsPayloadPatchSchema.parse(input.patch);
    const before = await this.dependencies.repository.getOrCreateDraft();
    const updated = await this.dependencies.repository.saveDraft(patch);

    if (this.dependencies.audits) {
      await this.dependencies.audits.create({
        actorUserId,
        actionType: "system_settings.update_draft",
        targetType: "system_settings",
        targetId: updated.id,
        beforePayload: before.payload,
        afterPayload: updated.payload,
        metadata: buildAuditMetadata({
          kind: "draft_update",
          draft: updated,
          patch,
          actorUserId
        })
      });
    }

    return this.read();
  }

  async publish(input: { actorUserId: string }): Promise<SystemSettingsState> {
    const actorUserId = trimOrUndefined(input.actorUserId);
    if (!actorUserId) {
      throw new Error("actorUserId is required");
    }

    const before = await this.dependencies.repository.getOrCreateDraft();
    const published = await this.dependencies.repository.publishDraft({ publishedByUserId: actorUserId });

    if (this.dependencies.audits) {
      await this.dependencies.audits.create({
        actorUserId,
        actionType: "system_settings.publish",
        targetType: "system_settings",
        targetId: published.id,
        beforePayload: before.payload,
        afterPayload: published.payload,
        metadata: buildAuditMetadata({
          kind: "publish",
          draft: before,
          published,
          actorUserId
        })
      });
    }

    return this.read();
  }
}
