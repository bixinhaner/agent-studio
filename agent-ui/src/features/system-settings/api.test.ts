import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", () => ({
  api: vi.fn()
}));

import { api } from "../../lib/api";
import type { SystemSettingsPayload } from "./types";
import { fetchSystemSettings, publishSystemSettings, saveSystemSettingsDraft } from "./api";

const mockedApi = vi.mocked(api);

const draft: SystemSettingsPayload = {
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

describe("system settings api", () => {
  it("fetches the system settings admin payload", async () => {
    mockedApi.mockResolvedValueOnce({
      draft,
      published: draft,
      draftMeta: {
        id: "system-settings-version-2",
        versionNumber: 2,
        status: "draft",
        createdAt: "2026-03-30T01:00:00.000Z",
        updatedAt: "2026-03-30T01:30:00.000Z",
        publishedAt: null,
        publishedByUserId: null
      },
      publishedMeta: {
        id: "system-settings-version-1",
        versionNumber: 1,
        status: "published",
        createdAt: "2026-03-29T01:00:00.000Z",
        updatedAt: "2026-03-29T01:30:00.000Z",
        publishedAt: "2026-03-29T02:00:00.000Z",
        publishedByUserId: "admin-1"
      }
    });

    await fetchSystemSettings();

    expect(mockedApi).toHaveBeenCalledWith("/api/admin/system-settings");
  });

  it("saves the draft payload through the admin endpoint", async () => {
    mockedApi.mockResolvedValueOnce({
      draft,
      published: draft,
      draftMeta: {
        id: "system-settings-version-2",
        versionNumber: 2,
        status: "draft",
        createdAt: "2026-03-30T01:00:00.000Z",
        updatedAt: "2026-03-30T01:30:00.000Z",
        publishedAt: null,
        publishedByUserId: null
      },
      publishedMeta: null
    });

    await saveSystemSettingsDraft(draft);

    expect(mockedApi).toHaveBeenCalledWith("/api/admin/system-settings/draft", {
      method: "PUT",
      json: draft
    });
  });

  it("publishes the current draft through the admin endpoint", async () => {
    mockedApi.mockResolvedValueOnce({
      draft,
      published: draft,
      draftMeta: {
        id: "system-settings-version-2",
        versionNumber: 2,
        status: "draft",
        createdAt: "2026-03-30T01:00:00.000Z",
        updatedAt: "2026-03-30T01:30:00.000Z",
        publishedAt: null,
        publishedByUserId: null
      },
      publishedMeta: {
        id: "system-settings-version-3",
        versionNumber: 3,
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
