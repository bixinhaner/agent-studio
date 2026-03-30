import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  archiveInboxItem: vi.fn(),
  fetchInboxItems: vi.fn(),
  markInboxItemRead: vi.fn(),
  markInboxItemUnread: vi.fn(),
  unarchiveInboxItem: vi.fn()
}));

import {
  archiveInboxItem,
  fetchInboxItems,
  markInboxItemRead,
  markInboxItemUnread,
  unarchiveInboxItem
} from "./api";
import { InboxShell } from "./InboxShell";
import type { InboxItemRecord } from "./types";

const mockedFetchInboxItems = vi.mocked(fetchInboxItems);
const mockedMarkInboxItemRead = vi.mocked(markInboxItemRead);
const mockedMarkInboxItemUnread = vi.mocked(markInboxItemUnread);
const mockedArchiveInboxItem = vi.mocked(archiveInboxItem);
const mockedUnarchiveInboxItem = vi.mocked(unarchiveInboxItem);

function buildItems(): InboxItemRecord[] {
  return [
    {
      id: "inbox-1",
      userId: "user-1",
      eventType: "comment.created",
      category: "collaboration",
      title: "线程需要协作确认",
      body: "owner-1 提到了你",
      status: "unread",
      threadId: "thread-1",
      relatedEntityType: "thread_comment",
      relatedEntityId: "comment-1",
      sourceActorUserId: "owner-1",
      createdAt: "2026-03-31T01:00:00.000Z",
      updatedAt: "2026-03-31T01:00:00.000Z"
    },
    {
      id: "inbox-2",
      userId: "user-1",
      eventType: "alert.opened",
      category: "alert",
      title: "模型延迟告警",
      body: "openai-prod 出现高延迟",
      status: "read",
      createdAt: "2026-03-31T02:00:00.000Z",
      updatedAt: "2026-03-31T02:10:00.000Z",
      readAt: "2026-03-31T02:10:00.000Z"
    },
    {
      id: "inbox-3",
      userId: "user-1",
      eventType: "broadcast.published",
      category: "broadcast",
      title: "节假日值班安排",
      body: "请查看清明假期值班表",
      status: "archived",
      createdAt: "2026-03-31T03:00:00.000Z",
      updatedAt: "2026-03-31T03:10:00.000Z",
      readAt: "2026-03-31T03:05:00.000Z",
      archivedAt: "2026-03-31T03:10:00.000Z"
    }
  ];
}

describe("InboxShell", () => {
  beforeEach(() => {
    mockedFetchInboxItems.mockReset();
    mockedMarkInboxItemRead.mockReset();
    mockedMarkInboxItemUnread.mockReset();
    mockedArchiveInboxItem.mockReset();
    mockedUnarchiveInboxItem.mockReset();
  });

  it("loads inbox items, filters by tabs, and applies read-unread-archive actions", async () => {
    const items = buildItems();
    mockedFetchInboxItems.mockResolvedValue(items);
    mockedMarkInboxItemRead.mockResolvedValue({ ...items[0], status: "read", readAt: "2026-03-31T01:05:00.000Z" });
    mockedMarkInboxItemUnread.mockResolvedValue({ ...items[1], status: "unread", readAt: undefined });
    mockedArchiveInboxItem.mockResolvedValue({
      ...items[1],
      status: "archived",
      readAt: "2026-03-31T02:10:00.000Z",
      archivedAt: "2026-03-31T02:20:00.000Z"
    });
    mockedUnarchiveInboxItem.mockResolvedValue({
      ...items[2],
      status: "read",
      archivedAt: undefined,
      readAt: "2026-03-31T03:05:00.000Z"
    });

    render(<InboxShell />);

    expect(await screen.findByRole("heading", { name: "通知中心" })).toBeTruthy();
    expect(screen.getByText("线程需要协作确认")).toBeTruthy();
    expect(screen.getByText("模型延迟告警")).toBeTruthy();
    expect(screen.getByText("节假日值班安排")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "协作" }));
    expect(screen.getByText("线程需要协作确认")).toBeTruthy();
    expect(screen.queryByText("模型延迟告警")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "标记已读" }));
    await waitFor(() => expect(mockedMarkInboxItemRead).toHaveBeenCalledWith("inbox-1"));
    expect(await screen.findByRole("button", { name: "标记未读" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "告警" }));
    expect(screen.getByText("模型延迟告警")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "标记未读" }));
    await waitFor(() => expect(mockedMarkInboxItemUnread).toHaveBeenCalledWith("inbox-2"));
    expect(await screen.findByRole("button", { name: "标记已读" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "归档" }));
    await waitFor(() => expect(mockedArchiveInboxItem).toHaveBeenCalledWith("inbox-2"));
    expect(screen.getByText("当前筛选下暂无消息。")) .toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "广播" }));
    expect(screen.getByText("节假日值班安排")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消归档" }));
    await waitFor(() => expect(mockedUnarchiveInboxItem).toHaveBeenCalledWith("inbox-3"));
    expect(await screen.findByRole("button", { name: "归档" })).toBeTruthy();
  });

  it("shows an error state when loading fails", async () => {
    mockedFetchInboxItems.mockRejectedValue(new Error("加载 inbox 失败"));

    render(<InboxShell />);

    expect(await screen.findByText("加载 inbox 失败")).toBeTruthy();
  });
});
