import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createCollaborationRouter } from "./router.js";

function buildApp(options?: {
  userId?: string;
  departmentIds?: string[];
  collaboration?: Partial<Parameters<typeof createCollaborationRouter>[0]["collaboration"]>;
  inbox?: Partial<Parameters<typeof createCollaborationRouter>[0]["inbox"]>;
}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.currentUser = {
      id: options?.userId ?? "user-1",
      role: "employee",
      createdAt: new Date("2026-03-31T00:00:00.000Z").toISOString(),
      updatedAt: new Date("2026-03-31T00:00:00.000Z").toISOString()
    };
    next();
  });
  app.use(
    createCollaborationRouter({
      collaboration: {
        getThreadCollaborationView: vi.fn(async ({ threadId }) => ({
          threadId,
          ownerUserId: "owner-1",
          access: {
            canRead: true,
            canComment: true,
            canRun: false,
            isOwner: false
          },
          shares: [{ id: "share-1", threadId, subjectType: "user", subjectId: "user-1", permissionLevel: "read_comment", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
          comments: [{ id: "comment-1", threadId, bodyMarkdown: "hello", mentionedUserIds: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
          assignment: { ownerUserId: "owner-2", assignedByUserId: "admin-1", assignedAt: new Date().toISOString() },
          followers: [{ id: "follower-1", threadId, userId: "user-3", addedByUserId: "admin-1", createdAt: new Date().toISOString() }],
          captureMark: null
        })),
        replaceShares: vi.fn(async ({ threadId, shares }) => shares.map((share: { subjectType: string; subjectId: string }, index: number) => ({
          id: `share-${index + 1}`,
          threadId,
          subjectType: share.subjectType,
          subjectId: share.subjectId,
          permissionLevel: "read_comment",
          sharedByUserId: "user-1",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }))),
        addComment: vi.fn(async ({ threadId, bodyMarkdown, mentionedUserIds }) => ({
          id: "comment-new",
          threadId,
          authorUserId: "user-1",
          bodyMarkdown,
          mentionedUserIds,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })),
        setAssignment: vi.fn(async ({ ownerUserId, followerIds }) => ({
          assignment: { ownerUserId, assignedByUserId: "user-1", assignedAt: new Date().toISOString() },
          followers: (followerIds ?? ["user-3"]).map((userId: string, index: number) => ({ id: `follower-${index + 1}`, threadId: "thread-1", userId, addedByUserId: "user-1", createdAt: new Date().toISOString() })),
          captureMark: null
        })),
        setFollowers: vi.fn(async ({ followerIds }) => ({
          followers: followerIds.map((userId: string, index: number) => ({ id: `follower-${index + 1}`, threadId: "thread-1", userId, addedByUserId: "user-1", createdAt: new Date().toISOString() }))
        })),
        setCaptureMark: vi.fn(async ({ enabled, note }) =>
          enabled
            ? { id: "capture-1", threadId: "thread-1", status: "pending_capture", markedByUserId: "user-1", markedAt: new Date().toISOString(), note: note ?? undefined, updatedAt: new Date().toISOString() }
            : null
        ),
        ...options?.collaboration
      },
      inbox: {
        listForUser: vi.fn(async () => [
          {
            id: "inbox-1",
            userId: "user-1",
            eventType: "thread.shared",
            category: "collaboration",
            title: "Shared",
            body: "A thread was shared.",
            status: "unread",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        ]),
        markRead: vi.fn(async (itemId: string) => ({
          id: itemId,
          userId: "user-1",
          eventType: "thread.shared",
          category: "collaboration",
          title: "Shared",
          body: "A thread was shared.",
          status: "read",
          readAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })),
        markUnread: vi.fn(async (itemId: string) => ({
          id: itemId,
          userId: "user-1",
          eventType: "thread.shared",
          category: "collaboration",
          title: "Shared",
          body: "A thread was shared.",
          status: "unread",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })),
        archive: vi.fn(async (itemId: string) => ({
          id: itemId,
          userId: "user-1",
          eventType: "thread.shared",
          category: "collaboration",
          title: "Shared",
          body: "A thread was shared.",
          status: "archived",
          archivedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })),
        unarchive: vi.fn(async (itemId: string) => ({
          id: itemId,
          userId: "user-1",
          eventType: "thread.shared",
          category: "collaboration",
          title: "Shared",
          body: "A thread was shared.",
          status: "read",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })),
        ...options?.inbox
      },
      listDepartmentIdsForUser: vi.fn(async () => options?.departmentIds ?? ["dept-1"])
    })
  );
  return app;
}

describe("createCollaborationRouter", () => {
  it("returns collaboration state for a shared thread viewer", async () => {
    const app = buildApp();

    const response = await request(app).get("/api/threads/thread-1/collaboration");

    expect(response.status).toBe(200);
    expect(response.body.collaboration.access.canComment).toBe(true);
    expect(response.body.collaboration.threadId).toBe("thread-1");
  });

  it("updates shares, comments, assignment, followers, capture mark, and inbox item state", async () => {
    const setAssignment = vi.fn(async ({ ownerUserId, followerIds }) => ({
      assignment: { ownerUserId, assignedByUserId: "user-1", assignedAt: new Date().toISOString() },
      followers: (followerIds ?? ["user-3"]).map((userId: string, index: number) => ({ id: `follower-${index + 1}`, threadId: "thread-1", userId, addedByUserId: "user-1", createdAt: new Date().toISOString() })),
      captureMark: null
    }));
    const setFollowers = vi.fn(async ({ followerIds }) => ({
      followers: followerIds.map((userId: string, index: number) => ({ id: `follower-${index + 1}`, threadId: "thread-1", userId, addedByUserId: "user-1", createdAt: new Date().toISOString() }))
    }));
    const app = buildApp({ collaboration: { setAssignment, setFollowers } });

    const shares = await request(app)
      .put("/api/threads/thread-1/shares")
      .send({ shares: [{ subject_type: "user", subject_id: "user-2" }] });
    expect(shares.status).toBe(200);
    expect(shares.body.shares).toHaveLength(1);

    const comments = await request(app).get("/api/threads/thread-1/comments");
    expect(comments.status).toBe(200);
    expect(comments.body.comments).toHaveLength(1);

    const postComment = await request(app)
      .post("/api/threads/thread-1/comments")
      .send({ body_markdown: "hello @user-2", mentioned_user_ids: ["user-2"] });
    expect(postComment.status).toBe(200);
    expect(postComment.body.comment.bodyMarkdown).toBe("hello @user-2");

    const assignment = await request(app)
      .put("/api/threads/thread-1/assignment")
      .send({ owner_user_id: "user-9" });
    expect(assignment.status).toBe(200);
    expect(assignment.body.assignment.ownerUserId).toBe("user-9");

    const followers = await request(app)
      .put("/api/threads/thread-1/followers")
      .send({ follower_ids: ["user-5", "user-6"] });
    expect(followers.status).toBe(200);
    expect(followers.body.followers).toHaveLength(2);
    expect(setFollowers).toHaveBeenLastCalledWith(
      expect.objectContaining({
        actorUserId: "user-1",
        threadId: "thread-1",
        followerIds: ["user-5", "user-6"]
      })
    );

    const capture = await request(app)
      .put("/api/threads/thread-1/capture-mark")
      .send({ enabled: true, note: "capture this" });
    expect(capture.status).toBe(200);
    expect(capture.body.captureMark.status).toBe("pending_capture");

    const inbox = await request(app).get("/api/inbox");
    expect(inbox.status).toBe(200);
    expect(inbox.body.items).toHaveLength(1);

    const read = await request(app).post("/api/inbox/inbox-1/read");
    expect(read.status).toBe(200);
    expect(read.body.item.status).toBe("read");

    const unread = await request(app).post("/api/inbox/inbox-1/unread");
    expect(unread.status).toBe(200);
    expect(unread.body.item.status).toBe("unread");

    const archive = await request(app).post("/api/inbox/inbox-1/archive");
    expect(archive.status).toBe(200);
    expect(archive.body.item.status).toBe("archived");

    const unarchive = await request(app).post("/api/inbox/inbox-1/unarchive");
    expect(unarchive.status).toBe(200);
    expect(unarchive.body.item.status).toBe("read");
  });

  it("maps collaboration access denial to forbidden", async () => {
    const app = buildApp({
      collaboration: {
        getThreadCollaborationView: vi.fn(async () => {
          throw new Error("thread collaboration access denied");
        })
      }
    });

    const response = await request(app).get("/api/threads/thread-1/collaboration");

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ detail: "thread collaboration access denied" });
  });

  it("allows assignment updates without depending on collaboration read access", async () => {
    const setAssignment = vi.fn(async ({ ownerUserId, followerIds }) => ({
      assignment: { ownerUserId, assignedByUserId: "user-1", assignedAt: new Date().toISOString() },
      followers: (followerIds ?? ["user-3"]).map((userId: string, index: number) => ({ id: `follower-${index + 1}`, threadId: "thread-1", userId, addedByUserId: "user-1", createdAt: new Date().toISOString() })),
      captureMark: null
    }));
    const app = buildApp({
      collaboration: {
        getThreadCollaborationView: vi.fn(async () => {
          throw new Error("thread collaboration access denied");
        }),
        setAssignment
      }
    });

    const response = await request(app).put("/api/threads/thread-1/assignment").send({ owner_user_id: "user-2" });

    expect(response.status).toBe(200);
    expect(response.body.assignment.ownerUserId).toBe("user-2");
    expect(setAssignment).toHaveBeenCalled();
    expect(setAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "user-1",
        threadId: "thread-1",
        ownerUserId: "user-2",
        followerIds: undefined
      })
    );
    expect(response.body.followers).toHaveLength(1);
  });

  it("allows follower-only updates without requiring an assignment owner row", async () => {
    const setFollowers = vi.fn(async ({ followerIds }) => ({
      followers: followerIds.map((userId: string, index: number) => ({ id: `follower-${index + 1}`, threadId: "thread-1", userId, addedByUserId: "user-1", createdAt: new Date().toISOString() }))
    }));
    const app = buildApp({
      collaboration: {
        getThreadCollaborationView: vi.fn(async () => {
          throw new Error("thread collaboration access denied");
        }),
        setFollowers
      }
    });

    const response = await request(app).put("/api/threads/thread-1/followers").send({ follower_ids: ["user-2"] });

    expect(response.status).toBe(200);
    expect(response.body.followers).toHaveLength(1);
    expect(setFollowers).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "user-1",
        threadId: "thread-1",
        followerIds: ["user-2"]
      })
    );
  });
});
