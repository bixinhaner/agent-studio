import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  addThreadComment: vi.fn(),
  replaceThreadShares: vi.fn(),
  setThreadAssignment: vi.fn(),
  setThreadCaptureMark: vi.fn()
}));

import { addThreadComment, replaceThreadShares, setThreadAssignment, setThreadCaptureMark } from "./api";
import { ThreadCollaborationPanel } from "./ThreadCollaborationPanel";
import type { ThreadCollaborationView } from "./types";

const mockedAddThreadComment = vi.mocked(addThreadComment);
const mockedReplaceThreadShares = vi.mocked(replaceThreadShares);
const mockedSetThreadAssignment = vi.mocked(setThreadAssignment);
const mockedSetThreadCaptureMark = vi.mocked(setThreadCaptureMark);

function buildView(): ThreadCollaborationView {
  return {
    threadId: "thread-1",
    ownerUserId: "owner-1",
    access: {
      canRead: true,
      canComment: true,
      canRun: true,
      isOwner: true
    },
    shares: [
      {
        id: "share-1",
        threadId: "thread-1",
        subjectType: "user",
        subjectId: "user-2",
        permissionLevel: "read_comment",
        sharedByUserId: "owner-1",
        createdAt: "2026-03-31T00:00:00.000Z",
        updatedAt: "2026-03-31T00:00:00.000Z"
      }
    ],
    comments: [
      {
        id: "comment-1",
        threadId: "thread-1",
        authorUserId: "owner-1",
        bodyMarkdown: "Existing note",
        mentionedUserIds: [],
        createdAt: "2026-03-31T00:00:00.000Z",
        updatedAt: "2026-03-31T00:00:00.000Z"
      }
    ],
    assignment: {
      id: "assignment-1",
      threadId: "thread-1",
      ownerUserId: "owner-1",
      assignedByUserId: "owner-1",
      assignedAt: "2026-03-31T00:00:00.000Z",
      updatedAt: "2026-03-31T00:00:00.000Z"
    },
    followers: [
      {
        id: "follower-1",
        threadId: "thread-1",
        userId: "user-3",
        addedByUserId: "owner-1",
        createdAt: "2026-03-31T00:00:00.000Z"
      }
    ],
    captureMark: null
  };
}

describe("ThreadCollaborationPanel", () => {
  beforeEach(() => {
    mockedAddThreadComment.mockReset();
    mockedReplaceThreadShares.mockReset();
    mockedSetThreadAssignment.mockReset();
    mockedSetThreadCaptureMark.mockReset();
  });

  it("renders collaboration state and applies share, comment, assignment, and capture updates", async () => {
    const onCollaborationChange = vi.fn();
    mockedReplaceThreadShares.mockResolvedValue([
      {
        id: "share-2",
        threadId: "thread-1",
        subjectType: "department",
        subjectId: "dept-ops",
        permissionLevel: "read_comment",
        sharedByUserId: "owner-1",
        createdAt: "2026-03-31T01:00:00.000Z",
        updatedAt: "2026-03-31T01:00:00.000Z"
      }
    ]);
    mockedAddThreadComment.mockResolvedValue({
      id: "comment-2",
      threadId: "thread-1",
      authorUserId: "owner-1",
      bodyMarkdown: "Need review",
      mentionedUserIds: ["user-9", "user-10"],
      createdAt: "2026-03-31T01:00:00.000Z",
      updatedAt: "2026-03-31T01:00:00.000Z"
    });
    mockedSetThreadAssignment.mockResolvedValue({
      assignment: {
        id: "assignment-2",
        threadId: "thread-1",
        ownerUserId: "user-8",
        assignedByUserId: "owner-1",
        assignedAt: "2026-03-31T01:00:00.000Z",
        updatedAt: "2026-03-31T01:00:00.000Z"
      },
      followers: [
        {
          id: "follower-2",
          threadId: "thread-1",
          userId: "user-11",
          addedByUserId: "owner-1",
          createdAt: "2026-03-31T01:00:00.000Z"
        }
      ]
    });
    mockedSetThreadCaptureMark.mockResolvedValue({
      id: "capture-1",
      threadId: "thread-1",
      status: "pending_capture",
      markedByUserId: "owner-1",
      markedAt: "2026-03-31T01:00:00.000Z",
      note: "Add to KB",
      updatedAt: "2026-03-31T01:00:00.000Z"
    });

    function Harness() {
      const [collaboration, setCollaboration] = useState(buildView());
      return (
        <ThreadCollaborationPanel
          threadId="thread-1"
          collaboration={collaboration}
          loading={false}
          errorText=""
          onCollaborationChange={(next) => {
            onCollaborationChange(next);
            setCollaboration(next);
          }}
        />
      );
    }

    render(<Harness />);

    expect(screen.getByText("Existing note")).toBeTruthy();
    expect(screen.getByDisplayValue("user:user-2")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("共享对象"), { target: { value: "department:dept-ops" } });
    fireEvent.click(screen.getByRole("button", { name: "更新共享" }));

    await waitFor(() => {
      expect(mockedReplaceThreadShares).toHaveBeenCalledWith("thread-1", [{ subjectType: "department", subjectId: "dept-ops" }]);
    });

    fireEvent.change(screen.getByLabelText("评论内容"), { target: { value: "Need review" } });
    fireEvent.change(screen.getByLabelText("提及用户 ID"), { target: { value: "user-9, user-10" } });
    fireEvent.click(screen.getByRole("button", { name: "发送评论" }));

    await waitFor(() => {
      expect(mockedAddThreadComment).toHaveBeenCalledWith("thread-1", {
        bodyMarkdown: "Need review",
        mentionedUserIds: ["user-9", "user-10"]
      });
    });

    fireEvent.change(screen.getByLabelText("协作负责人"), { target: { value: "user-8" } });
    fireEvent.change(screen.getByLabelText("关注人 ID"), { target: { value: "user-11" } });
    fireEvent.click(screen.getByRole("button", { name: "保存协作人" }));

    await waitFor(() => {
      expect(mockedSetThreadAssignment).toHaveBeenCalledWith("thread-1", {
        ownerUserId: "user-8",
        followerIds: ["user-11"]
      });
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "标记为待知识捕获" }));
    fireEvent.change(screen.getByLabelText("捕获备注"), { target: { value: "Add to KB" } });
    fireEvent.click(screen.getByRole("button", { name: "保存捕获标记" }));

    await waitFor(() => {
      expect(mockedSetThreadCaptureMark).toHaveBeenCalledWith("thread-1", {
        enabled: true,
        note: "Add to KB"
      });
    });

    await waitFor(() => {
      expect(onCollaborationChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          shares: [expect.objectContaining({ subjectId: "dept-ops" })],
          comments: expect.arrayContaining([expect.objectContaining({ bodyMarkdown: "Need review" })]),
          assignment: expect.objectContaining({ ownerUserId: "user-8" }),
          followers: [expect.objectContaining({ userId: "user-11" })],
          captureMark: expect.objectContaining({ status: "pending_capture", note: "Add to KB" })
        })
      );
    });
  });

  it("shows the readonly shared-thread message while still listing collaboration history", () => {
    render(
      <ThreadCollaborationPanel
        threadId="thread-1"
        collaboration={{
          ...buildView(),
          access: {
            canRead: true,
            canComment: true,
            canRun: false,
            isOwner: false
          }
        }}
        loading={false}
        errorText=""
        onCollaborationChange={vi.fn()}
      />
    );

    expect(screen.getByText("共享视图中只能查看历史与发表评论，不能继续运行该线程。")).toBeTruthy();
    expect(screen.getByText("Existing note")).toBeTruthy();
  });
});
