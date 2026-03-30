import { describe, expect, it } from "vitest";

import { SystemSettingsService } from "./service.js";
import { createDefaultSystemSettingsPayload, mergeSystemSettingsPayload, type SystemSettingsVersionRecord } from "./types.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function createVersionRecord(overrides: Partial<SystemSettingsVersionRecord> & { id: string; versionNumber: number }): SystemSettingsVersionRecord {
  const now = new Date("2026-03-30T00:00:00.000Z").toISOString();
  return {
    id: overrides.id,
    versionNumber: overrides.versionNumber,
    revision: overrides.revision ?? 0,
    status: overrides.status ?? "draft",
    payload: overrides.payload ?? createDefaultSystemSettingsPayload(),
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    publishedAt: overrides.publishedAt,
    publishedByUserId: overrides.publishedByUserId
  };
}

function createServiceDouble(options?: { published?: SystemSettingsVersionRecord }) {
  const audits: Array<Record<string, unknown>> = [];
  let draft = createVersionRecord({ id: "system-settings-version-1", versionNumber: 1 });
  let published = options?.published ? clone(options.published) : undefined;

  const service = new SystemSettingsService({
    repository: {
      async getOrCreateDraft() {
        return clone(draft);
      },
      async saveDraft(patch) {
        const nextDraft = {
          ...draft,
          payload: mergeSystemSettingsPayload(draft.payload, patch),
          revision: draft.revision + 1,
          updatedAt: new Date("2026-03-30T00:01:00.000Z").toISOString()
        };
        draft = nextDraft;
        return clone(nextDraft);
      },
      async publishDraft(input) {
        const nextPublished = createVersionRecord({
          id: "system-settings-version-2",
          versionNumber: 2,
          revision: draft.revision + 1,
          status: "published",
          payload: draft.payload,
          publishedAt: new Date("2026-03-30T00:02:00.000Z").toISOString(),
          publishedByUserId: input.publishedByUserId
        });
        published = nextPublished;
        draft = {
          ...draft,
          revision: draft.revision + 1,
          updatedAt: new Date("2026-03-30T00:02:00.000Z").toISOString()
        };
        return clone(nextPublished);
      },
      async getCurrentPublished() {
        return published ? clone(published) : undefined;
      }
    },
    audits: {
      async create(input) {
        audits.push(clone(input));
        return input as never;
      }
    }
  });

  return { service, audits, draft: () => clone(draft), published: () => (published ? clone(published) : undefined) };
}

describe("SystemSettingsService", () => {
  it("reads the current draft and published settings", async () => {
    const published = createVersionRecord({
      id: "system-settings-version-2",
      versionNumber: 2,
      status: "published",
      publishedAt: "2026-03-30T00:05:00.000Z",
      publishedByUserId: "admin-1"
    });
    const { service } = createServiceDouble({ published });

    const state = await service.read();

    expect(state.draft.status).toBe("draft");
    expect(state.published?.status).toBe("published");
    expect(state.draftMeta).toMatchObject({
      id: "system-settings-version-1",
      versionNumber: 1,
      status: "draft"
    });
    expect(state.publishedMeta).toMatchObject({
      id: "system-settings-version-2",
      versionNumber: 2,
      status: "published",
      publishedByUserId: "admin-1"
    });
  });

  it("saves draft updates and writes an admin audit event", async () => {
    const { service, audits, draft } = createServiceDouble();

    const state = await service.updateDraft({
      actorUserId: "admin-1",
      patch: {
        branding: {
          platformName: "Agent Studio Pro"
        }
      }
    });

    expect(state.draft.payload.branding.platformName).toBe("Agent Studio Pro");
    expect(draft().payload.branding.platformName).toBe("Agent Studio Pro");
    expect(audits).toEqual([
      expect.objectContaining({
        actionType: "system_settings.update_draft",
        actorUserId: "admin-1",
        targetType: "system_settings",
        targetId: "system-settings-version-1",
        metadata: expect.objectContaining({
          versionNumber: 1,
          revision: 1
        })
      })
    ]);
  });

  it("publishes the draft and records publish metadata", async () => {
    const { service, audits, published } = createServiceDouble();

    const state = await service.publish({
      actorUserId: "admin-1"
    });

    expect(state.published?.status).toBe("published");
    expect(state.published?.publishedByUserId).toBe("admin-1");
    expect(published()?.publishedByUserId).toBe("admin-1");
    expect(audits).toEqual([
      expect.objectContaining({
        actionType: "system_settings.publish",
        actorUserId: "admin-1",
        targetType: "system_settings",
        targetId: "system-settings-version-2",
        metadata: expect.objectContaining({
          draftVersionNumber: 1,
          publishedVersionNumber: 2,
          publishedByUserId: "admin-1"
        })
      })
    ]);
  });
});
