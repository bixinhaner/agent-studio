import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SystemSettingsPayload, SystemSettingsVersionRecord } from "./types";

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

  it("shows a visible recovery state when the initial load fails", async () => {
    mockedFetchSystemSettings
      .mockRejectedValueOnce(new Error("service unavailable"))
      .mockResolvedValueOnce({
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

    render(<SystemSettingsShell />);

    expect(await screen.findByText("系统设置加载失败")).toBeTruthy();
    expect(screen.getByText("service unavailable")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试加载" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "重试加载" }));

    await waitFor(() => {
      expect(mockedFetchSystemSettings).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText("编辑中：v2")).toBeTruthy();
  });

  it("renders version records and handles the no-published case", async () => {
    const toLocaleStringSpy = vi.spyOn(Date.prototype, "toLocaleString").mockImplementation(function (this: Date) {
      return `LOCAL:${this.toISOString()}`;
    });

    mockedFetchSystemSettings.mockResolvedValue({
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

    render(<SystemSettingsShell />);

    expect(await screen.findByRole("heading", { name: "系统设置" })).toBeTruthy();
    expect(screen.getByText("编辑中：v2")).toBeTruthy();
    expect(screen.getAllByText("尚未发布").length).toBeGreaterThan(0);
    expect((screen.getByLabelText("平台名称") as HTMLInputElement).value).toBe("Agent Studio");

    fireEvent.click(screen.getByRole("tab", { name: "模型默认值" }));
    expect((screen.getByLabelText("默认提供方") as HTMLInputElement).value).toBe("openai_codex");
    expect((screen.getByLabelText("默认模型") as HTMLInputElement).value).toBe("gpt-5.4");

    fireEvent.click(screen.getByRole("tab", { name: "发布记录" }));
    expect(screen.getByText("最近发布")).toBeTruthy();
    expect(screen.getAllByText("尚未发布").length).toBeGreaterThan(0);

    toLocaleStringSpy.mockRestore();
  });

  it("shows inline validation errors for the affected sections", async () => {
    mockedFetchSystemSettings.mockResolvedValue({
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
    mockedSaveSystemSettingsDraft.mockRejectedValue(new Error("branding.platformName: must not be empty; retention.sessionDays: must be positive integer"));

    render(<SystemSettingsShell />);

    await screen.findByRole("heading", { name: "系统设置" });
    fireEvent.click(screen.getByRole("tab", { name: "发布记录" }));
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));

    expect(await screen.findByText("请修正标红字段后再试")).toBeTruthy();
    expect(screen.getByText("must not be empty")).toBeTruthy();
    expect((screen.getByDisplayValue("Agent Studio") as HTMLInputElement).getAttribute("aria-invalid")).toBe("true");

    fireEvent.click(screen.getByRole("tab", { name: "保留与上传" }));
    expect(screen.getByText("must be positive integer")).toBeTruthy();
    expect((screen.getByDisplayValue("30") as HTMLInputElement).getAttribute("aria-invalid")).toBe("true");
  });

  it("persists the edited draft before publishing when publish is clicked directly", async () => {
    let resolveSave: ((value: any) => void) | undefined;

    const savePromise = new Promise<any>((resolve) => {
      resolveSave = resolve;
    });

    mockedFetchSystemSettings.mockResolvedValue({
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

    mockedSaveSystemSettingsDraft.mockReturnValue(savePromise);
    mockedPublishSystemSettings.mockResolvedValue({
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

    render(<SystemSettingsShell />);

    await screen.findByRole("heading", { name: "系统设置" });
    fireEvent.change(screen.getByLabelText("平台名称"), { target: { value: "Agent Studio Prime" } });
    fireEvent.click(screen.getByRole("tab", { name: "发布记录" }));
    fireEvent.click(screen.getByRole("button", { name: "发布设置" }));

    expect(screen.getByRole("button", { name: "发布中..." }).getAttribute("disabled")).toBe("");
    expect(mockedPublishSystemSettings).not.toHaveBeenCalled();
    expect(mockedSaveSystemSettingsDraft).toHaveBeenCalledWith({
      ...payload,
      branding: {
        ...payload.branding,
        platformName: "Agent Studio Prime"
      }
    });

    await act(async () => {
      resolveSave?.({
        draft: createRecord({
          id: "system-settings-version-3",
          versionNumber: 3,
          revision: 2,
          payload: {
            ...payload,
            branding: {
              ...payload.branding,
              platformName: "Agent Studio Prime"
            }
          }
        }),
        published: null,
        draftMeta: {
          id: "system-settings-version-3",
          versionNumber: 3,
          revision: 2,
          status: "draft",
          createdAt: "2026-03-30T01:00:00.000Z",
          updatedAt: "2026-03-30T03:00:00.000Z"
        },
        publishedMeta: null
      });
    });

    expect(await screen.findByText("设置已发布")).toBeTruthy();
    expect(mockedPublishSystemSettings).toHaveBeenCalledTimes(1);
  });

  it("saves the edited draft and publishes the updated version records", async () => {
    const toLocaleStringSpy = vi.spyOn(Date.prototype, "toLocaleString").mockImplementation(function (this: Date) {
      return `LOCAL:${this.toISOString()}`;
    });

    mockedFetchSystemSettings.mockResolvedValue({
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

    mockedSaveSystemSettingsDraft.mockResolvedValue({
      draft: createRecord({
        id: "system-settings-version-3",
        versionNumber: 3,
        revision: 2,
        payload: {
          ...payload,
          branding: {
            ...payload.branding,
            platformName: "Agent Studio Prime"
          }
        }
      }),
      published: null,
      draftMeta: {
        id: "system-settings-version-3",
        versionNumber: 3,
        revision: 2,
        status: "draft",
        createdAt: "2026-03-30T01:00:00.000Z",
        updatedAt: "2026-03-30T03:00:00.000Z"
      },
      publishedMeta: null
    });

    mockedPublishSystemSettings.mockResolvedValue({
      draft: createRecord({
        id: "system-settings-version-3",
        versionNumber: 3,
        revision: 2,
        payload: {
          ...payload,
          branding: {
            ...payload.branding,
            platformName: "Agent Studio Prime"
          }
        }
      }),
      published: createRecord({
        id: "system-settings-version-4",
        versionNumber: 4,
        revision: 3,
        status: "published",
        payload: {
          ...payload,
          branding: {
            ...payload.branding,
            platformName: "Agent Studio Prime"
          }
        },
        publishedAt: "2026-03-30T03:50:00.000Z",
        publishedByUserId: "admin-2"
      }),
      draftMeta: {
        id: "system-settings-version-3",
        versionNumber: 3,
        revision: 2,
        status: "draft",
        createdAt: "2026-03-30T01:00:00.000Z",
        updatedAt: "2026-03-30T03:00:00.000Z"
      },
      publishedMeta: {
        id: "system-settings-version-4",
        versionNumber: 4,
        revision: 3,
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
      ...payload,
      branding: {
        ...payload.branding,
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
