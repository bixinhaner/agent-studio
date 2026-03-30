import { Router, type Request, type Response } from "express";
import { z } from "zod";

const shareSchema = z.object({
  subject_type: z.enum(["user", "department"]),
  subject_id: z.string().min(1)
});

const replaceSharesSchema = z.object({
  shares: z.array(shareSchema)
});

const commentSchema = z.object({
  body_markdown: z.string().min(1),
  mentioned_user_ids: z.array(z.string().min(1)).optional().default([])
});

const assignmentSchema = z.object({
  owner_user_id: z.string().min(1),
  follower_ids: z.array(z.string().min(1)).optional()
});

const followersSchema = z.object({
  follower_ids: z.array(z.string().min(1))
});

const captureMarkSchema = z.object({
  enabled: z.boolean(),
  note: z.string().trim().optional().nullable()
});

function detailFromError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? "invalid request";
  }
  return error instanceof Error ? error.message : "request failed";
}

function statusFromError(error: unknown): number {
  const detail = detailFromError(error).toLowerCase();
  if (detail.includes("unauthorized")) return 401;
  if (detail.includes("access denied") || detail.includes("forbidden")) return 403;
  if (detail.includes("not found") || detail.includes("不存在")) return 404;
  return 400;
}

async function requireCurrentUser(req: Request, res: Response): Promise<{ id: string } | null> {
  if (!req.currentUser) {
    res.status(401).json({ detail: "Unauthorized" });
    return null;
  }
  return req.currentUser;
}

export function createCollaborationRouter(options: {
  collaboration: {
    getThreadCollaborationView(input: { actorUserId: string; departmentIds: string[]; threadId: string }): Promise<{
      threadId: string;
      ownerUserId?: string;
      access: { canRead: boolean; canComment: boolean; canRun: boolean; isOwner: boolean };
      shares: unknown[];
      comments: unknown[];
      assignment: { ownerUserId?: string; assignedByUserId?: string; assignedAt?: string } | null;
      followers: unknown[];
      captureMark: unknown;
    }>;
    replaceShares(input: { actorUserId: string; threadId: string; shares: Array<{ subjectType: "user" | "department"; subjectId: string }> }): Promise<unknown[]>;
    addComment(input: { actorUserId: string; threadId: string; bodyMarkdown: string; mentionedUserIds: string[] }): Promise<unknown>;
    setAssignment(input: { actorUserId: string; threadId: string; ownerUserId: string; followerIds: string[] }): Promise<{
      assignment: { ownerUserId?: string; assignedByUserId?: string; assignedAt?: string } | null;
      followers: unknown[];
      captureMark: unknown;
    }>;
    setFollowers(input: { actorUserId: string; threadId: string; followerIds: string[] }): Promise<{ followers: unknown[] }>;
    setCaptureMark(input: { actorUserId: string; threadId: string; enabled: boolean; note?: string | null }): Promise<unknown>;
  };
  inbox: {
    listForUser(userId: string): Promise<unknown[]>;
    markRead(itemId: string, userId: string): Promise<unknown>;
    markUnread(itemId: string, userId: string): Promise<unknown>;
    archive(itemId: string, userId: string): Promise<unknown>;
    unarchive(itemId: string, userId: string): Promise<unknown>;
  };
  listDepartmentIdsForUser(userId: string): Promise<string[]>;
}): Router {
  const router = Router();

  router.get("/api/threads/:threadId/collaboration", async (req: Request, res: Response) => {
    const currentUser = await requireCurrentUser(req, res);
    if (!currentUser) return;

    try {
      const collaboration = await options.collaboration.getThreadCollaborationView({
        actorUserId: currentUser.id,
        departmentIds: await options.listDepartmentIdsForUser(currentUser.id),
        threadId: String(req.params.threadId || "").trim()
      });
      res.json({ collaboration });
    } catch (error) {
      res.status(statusFromError(error)).json({ detail: detailFromError(error) });
    }
  });

  router.put("/api/threads/:threadId/shares", async (req: Request, res: Response) => {
    const currentUser = await requireCurrentUser(req, res);
    if (!currentUser) return;

    try {
      const input = replaceSharesSchema.parse(req.body || {});
      const shares = await options.collaboration.replaceShares({
        actorUserId: currentUser.id,
        threadId: String(req.params.threadId || "").trim(),
        shares: input.shares.map((share) => ({
          subjectType: share.subject_type,
          subjectId: share.subject_id.trim()
        }))
      });
      res.json({ shares });
    } catch (error) {
      res.status(statusFromError(error)).json({ detail: detailFromError(error) });
    }
  });

  router.get("/api/threads/:threadId/comments", async (req: Request, res: Response) => {
    const currentUser = await requireCurrentUser(req, res);
    if (!currentUser) return;

    try {
      const collaboration = await options.collaboration.getThreadCollaborationView({
        actorUserId: currentUser.id,
        departmentIds: await options.listDepartmentIdsForUser(currentUser.id),
        threadId: String(req.params.threadId || "").trim()
      });
      res.json({ comments: collaboration.comments });
    } catch (error) {
      res.status(statusFromError(error)).json({ detail: detailFromError(error) });
    }
  });

  router.post("/api/threads/:threadId/comments", async (req: Request, res: Response) => {
    const currentUser = await requireCurrentUser(req, res);
    if (!currentUser) return;

    try {
      const input = commentSchema.parse(req.body || {});
      const comment = await options.collaboration.addComment({
        actorUserId: currentUser.id,
        threadId: String(req.params.threadId || "").trim(),
        bodyMarkdown: input.body_markdown.trim(),
        mentionedUserIds: input.mentioned_user_ids.map((userId) => userId.trim())
      });
      res.json({ comment });
    } catch (error) {
      res.status(statusFromError(error)).json({ detail: detailFromError(error) });
    }
  });

  router.put("/api/threads/:threadId/assignment", async (req: Request, res: Response) => {
    const currentUser = await requireCurrentUser(req, res);
    if (!currentUser) return;

    try {
      const input = assignmentSchema.parse(req.body || {});
      const state = await options.collaboration.setAssignment({
        actorUserId: currentUser.id,
        threadId: String(req.params.threadId || "").trim(),
        ownerUserId: input.owner_user_id.trim(),
        followerIds: input.follower_ids?.map((userId) => userId.trim()) ?? []
      });
      res.json({ assignment: state.assignment, followers: state.followers });
    } catch (error) {
      res.status(statusFromError(error)).json({ detail: detailFromError(error) });
    }
  });

  router.put("/api/threads/:threadId/followers", async (req: Request, res: Response) => {
    const currentUser = await requireCurrentUser(req, res);
    if (!currentUser) return;

    try {
      const input = followersSchema.parse(req.body || {});
      const state = await options.collaboration.setFollowers({
        actorUserId: currentUser.id,
        threadId: String(req.params.threadId || "").trim(),
        followerIds: input.follower_ids.map((userId) => userId.trim())
      });
      res.json({ followers: state.followers });
    } catch (error) {
      res.status(statusFromError(error)).json({ detail: detailFromError(error) });
    }
  });

  router.put("/api/threads/:threadId/capture-mark", async (req: Request, res: Response) => {
    const currentUser = await requireCurrentUser(req, res);
    if (!currentUser) return;

    try {
      const input = captureMarkSchema.parse(req.body || {});
      const captureMark = await options.collaboration.setCaptureMark({
        actorUserId: currentUser.id,
        threadId: String(req.params.threadId || "").trim(),
        enabled: input.enabled,
        note: input.note ?? undefined
      });
      res.json({ captureMark });
    } catch (error) {
      res.status(statusFromError(error)).json({ detail: detailFromError(error) });
    }
  });

  router.get("/api/inbox", async (req: Request, res: Response) => {
    const currentUser = await requireCurrentUser(req, res);
    if (!currentUser) return;

    try {
      const items = await options.inbox.listForUser(currentUser.id);
      res.json({ items });
    } catch (error) {
      res.status(statusFromError(error)).json({ detail: detailFromError(error) });
    }
  });

  router.post("/api/inbox/:itemId/read", async (req: Request, res: Response) => {
    const currentUser = await requireCurrentUser(req, res);
    if (!currentUser) return;

    try {
      const item = await options.inbox.markRead(String(req.params.itemId || "").trim(), currentUser.id);
      res.json({ item });
    } catch (error) {
      res.status(statusFromError(error)).json({ detail: detailFromError(error) });
    }
  });

  router.post("/api/inbox/:itemId/unread", async (req: Request, res: Response) => {
    const currentUser = await requireCurrentUser(req, res);
    if (!currentUser) return;

    try {
      const item = await options.inbox.markUnread(String(req.params.itemId || "").trim(), currentUser.id);
      res.json({ item });
    } catch (error) {
      res.status(statusFromError(error)).json({ detail: detailFromError(error) });
    }
  });

  router.post("/api/inbox/:itemId/archive", async (req: Request, res: Response) => {
    const currentUser = await requireCurrentUser(req, res);
    if (!currentUser) return;

    try {
      const item = await options.inbox.archive(String(req.params.itemId || "").trim(), currentUser.id);
      res.json({ item });
    } catch (error) {
      res.status(statusFromError(error)).json({ detail: detailFromError(error) });
    }
  });

  router.post("/api/inbox/:itemId/unarchive", async (req: Request, res: Response) => {
    const currentUser = await requireCurrentUser(req, res);
    if (!currentUser) return;

    try {
      const item = await options.inbox.unarchive(String(req.params.itemId || "").trim(), currentUser.id);
      res.json({ item });
    } catch (error) {
      res.status(statusFromError(error)).json({ detail: detailFromError(error) });
    }
  });

  return router;
}
