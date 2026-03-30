import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  createBroadcastDraft: vi.fn(),
  fetchAdminBroadcasts: vi.fn(),
  publishBroadcast: vi.fn(),
  updateBroadcastDraft: vi.fn()
}));

import {
  createBroadcastDraft,
  fetchAdminBroadcasts,
  publishBroadcast,
  updateBroadcastDraft
} from "./api";
import { BroadcastAdminView } from "./BroadcastAdminView";
import type { BroadcastRecord } from "./types";

const mockedFetchAdminBroadcasts = vi.mocked(fetchAdminBroadcasts);
const mockedCreateBroadcastDraft = vi.mocked(createBroadcastDraft);
const mockedUpdateBroadcastDraft = vi.mocked(updateBroadcastDraft);
const mockedPublishBroadcast = vi.mocked(publishBroadcast);

function buildBroadcasts(): BroadcastRecord[] {
  return [
    {
      id: "broadcast-1",
      title: "平台升级公告",
      bodyMarkdown: "今晚 22:00 发布升级",
      status: "draft",
      createdByUserId: "admin-1",
      dingtalkDeliveryEnabled: false,
      createdAt: "2026-03-31T01:00:00.000Z",
      updatedAt: "2026-03-31T01:00:00.000Z",
      targets: [{ id: "target-1", broadcastId: "broadcast-1", targetType: "all_users", createdAt: "2026-03-31T01:00:00.000Z" }]
    },
    {
      id: "broadcast-2",
      title: "已发布公告",
      bodyMarkdown: "值班表已更新",
      status: "published",
      createdByUserId: "admin-1",
      publishedAt: "2026-03-31T00:30:00.000Z",
      publishedByUserId: "admin-1",
      dingtalkDeliveryEnabled: true,
      createdAt: "2026-03-31T00:00:00.000Z",
      updatedAt: "2026-03-31T00:30:00.000Z",
      targets: [{ id: "target-2", broadcastId: "broadcast-2", targetType: "department", targetId: "ops", createdAt: "2026-03-31T00:00:00.000Z" }]
    }
  ];
}

describe("BroadcastAdminView", () => {
  beforeEach(() => {
    mockedFetchAdminBroadcasts.mockReset();
    mockedCreateBroadcastDraft.mockReset();
    mockedUpdateBroadcastDraft.mockReset();
    mockedPublishBroadcast.mockReset();
  });

  it("loads broadcasts and supports draft create, edit, and publish", async () => {
    const initial = buildBroadcasts();
    mockedFetchAdminBroadcasts.mockResolvedValue(initial);
    mockedCreateBroadcastDraft.mockResolvedValue({
      id: "broadcast-3",
      title: "新广播",
      bodyMarkdown: "需要确认本周发布窗口",
      status: "draft",
      createdByUserId: "admin-1",
      dingtalkDeliveryEnabled: false,
      createdAt: "2026-03-31T02:00:00.000Z",
      updatedAt: "2026-03-31T02:00:00.000Z",
      targets: [{ id: "target-3", broadcastId: "broadcast-3", targetType: "role", targetId: "admins", createdAt: "2026-03-31T02:00:00.000Z" }]
    });
    mockedUpdateBroadcastDraft.mockResolvedValue({
      ...initial[0],
      title: "平台升级公告（修订）",
      bodyMarkdown: "今晚 23:00 发布升级",
      dingtalkDeliveryEnabled: true,
      updatedAt: "2026-03-31T01:10:00.000Z",
      targets: [{ id: "target-4", broadcastId: "broadcast-1", targetType: "department", targetId: "ops", createdAt: "2026-03-31T01:10:00.000Z" }]
    });
    mockedPublishBroadcast.mockResolvedValue({
      id: "broadcast-1",
      title: "平台升级公告（修订）",
      bodyMarkdown: "今晚 23:00 发布升级",
      status: "published",
      createdByUserId: "admin-1",
      publishedAt: "2026-03-31T01:20:00.000Z",
      publishedByUserId: "admin-2",
      dingtalkDeliveryEnabled: true,
      createdAt: "2026-03-31T01:00:00.000Z",
      updatedAt: "2026-03-31T01:20:00.000Z",
      targets: [{ id: "target-4", broadcastId: "broadcast-1", targetType: "department", targetId: "ops", createdAt: "2026-03-31T01:10:00.000Z" }]
    });

    render(<BroadcastAdminView />);

    expect(await screen.findByRole("heading", { name: "广播管理" })).toBeTruthy();
    expect(screen.getByText("平台升级公告")).toBeTruthy();
    expect(screen.getByText("已发布公告")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "新广播" } });
    fireEvent.change(screen.getByLabelText("正文"), { target: { value: "需要确认本周发布窗口" } });
    fireEvent.change(screen.getByLabelText("目标"), { target: { value: "role:admins" } });
    fireEvent.click(screen.getByRole("button", { name: "新建草稿" }));

    await waitFor(() => {
      expect(mockedCreateBroadcastDraft).toHaveBeenCalledWith({
        title: "新广播",
        bodyMarkdown: "需要确认本周发布窗口",
        dingtalkDeliveryEnabled: false,
        targets: [{ targetType: "role", targetId: "admins" }]
      });
    });
    expect(await screen.findByText("新广播")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "编辑 平台升级公告" }));
    expect((screen.getByLabelText("标题") as HTMLInputElement).value).toBe("平台升级公告");
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "平台升级公告（修订）" } });
    fireEvent.change(screen.getByLabelText("正文"), { target: { value: "今晚 23:00 发布升级" } });
    fireEvent.change(screen.getByLabelText("目标"), { target: { value: "department:ops" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "同步发送到钉钉" }));
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));

    await waitFor(() => {
      expect(mockedUpdateBroadcastDraft).toHaveBeenCalledWith("broadcast-1", {
        title: "平台升级公告（修订）",
        bodyMarkdown: "今晚 23:00 发布升级",
        dingtalkDeliveryEnabled: true,
        targets: [{ targetType: "department", targetId: "ops" }]
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "发布 平台升级公告（修订）" }));
    await waitFor(() => expect(mockedPublishBroadcast).toHaveBeenCalledWith("broadcast-1"));
    expect(await screen.findByText("已于")) .toBeTruthy();
  });

  it("shows request failures inline", async () => {
    mockedFetchAdminBroadcasts.mockRejectedValue(new Error("加载广播列表失败"));

    render(<BroadcastAdminView />);

    expect(await screen.findByText("加载广播列表失败")).toBeTruthy();
  });
});
