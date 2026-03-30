import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", () => ({
  api: vi.fn()
}));

import { api } from "../../lib/api";
import type { SystemSettingsPayload, SystemSettingsVersionRecord } from "./types";
import { fetchSystemSettings, publishSystemSettings, saveSystemSettingsDraft } from "./api";

const mockedApi = vi.mocked(api);

const payload: SystemSettingsPayload = {
  branding: {
    platformName: "Agent Studio",
    headerSubtitle: "Enterprise Agent Platform",
    loginCopy: "Sign in with DingTalk to continue.",
    logoUrl: "https://example.com/logo.png",
    iconUrl: "https://example.com/icon.png"
  },
  platformDefaults: {
    provider: "openai_codex",
    model: "gpt-5.4",
    reasoningEffort: "high"
  },
  retention: {
    sessionDays: 30,
    attachmentDays: 30,
    alertDays: 14
  },
  uploads: {
    maxSingleFileBytes: 10485760,
    maxTotalUploadBytes: 52428800
  },
  safety: {
    allowDangerFullAccess: false,
    allowNetworkAccess: true,
    allowLiveWebSearch: true,
    allowCustomAdditionalDirectories: false,
    allowFilesystemMutations: true
  },
  organizationDefaults: {
    orgSyncIntervalMinutes: 1440
  },
  behavior: {
    welcomeSummary: "Use approved resources and modes only.",
    usageSummary: "New sessions use published platform defaults.",
    markdown: "## Platform Behavior"
  }
};

function createRecord(overrides: Partial<SystemSettingsVersionRecord> & { id: string; versionNumber: number }): SystemSettingsVersionRecord {
  return {
    id: overrides.id,
    versionNumber: overrides.versionNumber,
    revision: overrides.revision ?? 0,
    status: overrides.status ?? "draft",
    payload: overrides.payload ?? payload,
    createdAt: overrides.createdAt ?? "2026-03-30T01:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-03-30T01:30:00.000Z",
    publishedAt: overrides.publishedAt,
    publishedByUserId: overrides.publishedByUserId
  };
}

describe("system settings api", () => {
  it("fetches version records and allows no published version", async () => {
    mockedApi.mockResolvedValueOnce({
      draft: createRecord({ id: "system-settings-version-2", versionNumber: 2, revision: 1 }),
      published: null,
      draftMeta: {
        id: "system-settings-version-2",
        versionNumber: 2,
        revision: 1,
        status: "draft",
        createdAt: "2026-03-30T01:00:00.000Z",
        updatedAt: "2026-03-30T01:30:00.000Z"
      },
      publishedMeta: null
    });

    const response = await fetchSystemSettings();

    expect(mockedApi).toHaveBeenCalledWith("/api/admin/system-settings");
    expect(response.draft.payload.branding.platformName).toBe("Agent Studio");
    expect(response.published).toBeNull();
  });

  it("saves the current draft payload through the admin endpoint", async () => {
    mockedApi.mockResolvedValueOnce({
      draft: createRecord({ id: "system-settings-version-3", versionNumber: 3, revision: 2 }),
      published: null,
      draftMeta: {
        id: "system-settings-version-3",
        versionNumber: 3,
        revision: 2,
        status: "draft",
        createdAt: "2026-03-30T01:00:00.000Z",
        updatedAt: "2026-03-30T01:45:00.000Z"
      },
      publishedMeta: null
    });

    await saveSystemSettingsDraft(payload);

    expect(mockedApi).toHaveBeenCalledWith("/api/admin/system-settings/draft", {
      method: "PUT",
      json: payload
    });
  });

  it("publishes the current draft through the admin endpoint", async () => {
    mockedApi.mockResolvedValueOnce({
      draft: createRecord({ id: "system-settings-version-3", versionNumber: 3, revision: 2 }),
      published: createRecord({
        id: "system-settings-version-4",
        versionNumber: 4,
        revision: 3,
        status: "published",
        publishedAt: "2026-03-30T02:15:00.000Z",
        publishedByUserId: "admin-2"
      }),
      draftMeta: {
        id: "system-settings-version-3",
        versionNumber: 3,
        revision: 2,
        status: "draft",
        createdAt: "2026-03-30T01:00:00.000Z",
        updatedAt: "2026-03-30T01:45:00.000Z"
      },
      publishedMeta: {
        id: "system-settings-version-4",
        versionNumber: 4,
        revision: 3,
        status: "published",
        createdAt: "2026-03-30T02:00:00.000Z",
        updatedAt: "2026-03-30T02:10:00.000Z",
        publishedAt: "2026-03-30T02:15:00.000Z",
        publishedByUserId: "admin-2"
      }
    });

    await publishSystemSettings();

    expect(mockedApi).toHaveBeenCalledWith("/api/admin/system-settings/publish", {
      method: "POST"
    });
  });
});
