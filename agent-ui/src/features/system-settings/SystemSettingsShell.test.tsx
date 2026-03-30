import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const draft = {
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
    attachmentDays: 45,
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
    markdown: "## Platform Behavior\n\nDetailed guidance."
  }
};

const published = {
  ...draft,
  branding: {
    ...draft.branding,
    platformName: "Agent Studio Classic"
  }
};

vi.mock("./api", () => ({
  fetchSystemSettings: vi.fn(),
  saveSystemSettingsDraft: vi.fn(),
  publishSystemSettings: vi.fn()
}));

import { fetchSystemSettings, publishSystemSettings, saveSystemSettingsDraft } from "./api";
import { SystemSettingsShell } from "./SystemSettingsShell";

const mockedFetchSystemSettings = vi.mocked(fetchSystemSettings);
const mockedSaveSystemSettingsDraft = vi.mocked(saveSystemSettingsDraft);
const mockedPublishSystemSettings = vi.mocked(publishSystemSettings);

describe("SystemSettingsShell", () => {
  beforeEach(() => {
    mockedFetchSystemSettings.mockReset();
    mockedSaveSystemSettingsDraft.mockReset();
    mockedPublishSystemSettings.mockReset();
  });

  it("renders the system settings sections and local publish metadata", async () => {
    const toLocaleStringSpy = vi.spyOn(Date.prototype, "toLocaleString").mockImplementation(function (this: Date) {
      return `LOCAL:${this.toISOString()}`;
    });

    mockedFetchSystemSettings.mockResolvedValue({
      draft,
      published,
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

    render(<SystemSettingsShell />);

    expect(await screen.findByRole("heading", { name: "系统设置" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "基本设置" }).getAttribute("aria-selected")).toBe("true");
    expect((screen.getByLabelText("平台名称") as HTMLInputElement).value).toBe("Agent Studio");
    expect((screen.getByLabelText("欢迎摘要") as HTMLTextAreaElement).value).toBe("Use approved resources and modes only.");

    fireEvent.click(screen.getByRole("tab", { name: "模型默认值" }));
    expect((screen.getByLabelText("默认提供方") as HTMLInputElement).value).toBe("openai_codex");
    expect((screen.getByLabelText("默认模型") as HTMLInputElement).value).toBe("gpt-5.4");

    fireEvent.click(screen.getByRole("tab", { name: "发布记录" }));
    expect(screen.getByText("最近发布")).toBeTruthy();
    expect(screen.getByText("LOCAL:2026-03-29T02:00:00.000Z")).toBeTruthy();

    toLocaleStringSpy.mockRestore();
  });

  it("saves the edited draft and publishes it", async () => {
    const toLocaleStringSpy = vi.spyOn(Date.prototype, "toLocaleString").mockImplementation(function (this: Date) {
      return `LOCAL:${this.toISOString()}`;
    });

    mockedFetchSystemSettings.mockResolvedValue({
      draft,
      published,
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

    mockedSaveSystemSettingsDraft.mockResolvedValue({
      draft: {
        ...draft,
        branding: {
          ...draft.branding,
          platformName: "Agent Studio Prime"
        }
      },
      published,
      draftMeta: {
        id: "system-settings-version-3",
        versionNumber: 3,
        status: "draft",
        createdAt: "2026-03-30T01:00:00.000Z",
        updatedAt: "2026-03-30T03:00:00.000Z",
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

    mockedPublishSystemSettings.mockResolvedValue({
      draft: {
        ...draft,
        branding: {
          ...draft.branding,
          platformName: "Agent Studio Prime"
        }
      },
      published: {
        ...draft,
        branding: {
          ...draft.branding,
          platformName: "Agent Studio Prime"
        }
      },
      draftMeta: {
        id: "system-settings-version-3",
        versionNumber: 3,
        status: "draft",
        createdAt: "2026-03-30T01:00:00.000Z",
        updatedAt: "2026-03-30T03:00:00.000Z",
        publishedAt: null,
        publishedByUserId: null
      },
      publishedMeta: {
        id: "system-settings-version-4",
        versionNumber: 4,
        status: "published",
        createdAt: "2026-03-30T03:30:00.000Z",
        updatedAt: "2026-03-30T03:45:00.000Z",
        publishedAt: "2026-03-30T03:50:00.000Z",
        publishedByUserId: "admin-2"
      }
    });

    render(<SystemSettingsShell />);

    const platformNameInput = (await screen.findByLabelText("平台名称")) as HTMLInputElement;
    expect(platformNameInput.value).toBe("Agent Studio");
    fireEvent.change(screen.getByLabelText("平台名称"), { target: { value: "Agent Studio Prime" } });
    fireEvent.click(screen.getByRole("tab", { name: "发布记录" }));
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));

    expect(await screen.findByText("草稿已保存")).toBeTruthy();
    expect(mockedSaveSystemSettingsDraft).toHaveBeenCalledWith({
      ...draft,
      branding: {
        ...draft.branding,
        platformName: "Agent Studio Prime"
      }
    });

    fireEvent.click(screen.getByRole("button", { name: "发布设置" }));
    expect(await screen.findByText("设置已发布")).toBeTruthy();
    expect(mockedPublishSystemSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByText("LOCAL:2026-03-30T03:50:00.000Z")).toBeTruthy();

    toLocaleStringSpy.mockRestore();
  });
});
