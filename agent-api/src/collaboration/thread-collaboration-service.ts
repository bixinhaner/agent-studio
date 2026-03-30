import type { ThreadCaptureMarkRecord, ThreadCollaborationRepository, ThreadFollowerRecord } from "../persistence/thread-collaboration-repository.js";
import type { ThreadCommentRecord, ThreadCommentRepository } from "../persistence/thread-comment-repository.js";
import type { ThreadRecord, ThreadRepository } from "../persistence/thread-repository.js";
import type { ThreadShareInput, ThreadShareRecord, ThreadShareRepository } from "../persistence/thread-share-repository.js";
import type { CollaborationInboxProjectionInput, InboxProjectionService } from "./inbox-projection-service.js";

export type ThreadCollaborationView = {
  threadId: string;
  ownerUserId?: string;
  access: {
    canRead: boolean;
    canComment: boolean;
    canRun: boolean;
    isOwner: boolean;
  };
  shares: ThreadShareRecord[];
  comments: ThreadCommentRecord[];
  assignment: {
    ownerUserId?: string;
    assignedByUserId?: string;
    assignedAt?: string;
  } | null;
  followers: ThreadFollowerRecord[];
  captureMark: ThreadCaptureMarkRecord | null;
};

type CollaborationDirectory = {
  listDepartmentIdsForUser?: (userId: string) => Promise<string[]>;
  listUserIdsForDepartment?: (departmentId: string) => Promise<string[]>;
  ensureUsersExist?: (userIds: string[]) => Promise<void>;
};

type CollaborationAuthorizer = {
  canReadThreadCollaboration?: (input: { actorUserId: string; threadId: string; ownerUserId?: string }) => Promise<boolean>;
  canCommentThreadCollaboration?: (input: { actorUserId: string; threadId: string; ownerUserId?: string }) => Promise<boolean>;
  canManageThreadCollaboration?: (input: { actorUserId: string; threadId: string; ownerUserId?: string }) => Promise<boolean>;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function uniqueUserIds(userIds: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const userId of userIds) {
    const value = trimOrUndefined(userId);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

export class ThreadCollaborationService {
  constructor(
    private readonly deps: {
      threads: Pick<ThreadRepository, "get">;
      shares: Pick<ThreadShareRepository, "listForThread" | "listEffectiveForUser" | "replaceForThread">;
      comments: Pick<ThreadCommentRepository, "create" | "listForThread">;
      collaboration: Pick<ThreadCollaborationRepository, "getState" | "setAssignment" | "replaceFollowers" | "setCaptureMark">;
      inboxProjection?: Pick<InboxProjectionService, "projectCollaborationEvent">;
      directory?: CollaborationDirectory;
      authorizer?: CollaborationAuthorizer;
    }
  ) {}

  async getThreadCollaborationView(input: {
    actorUserId: string;
    departmentIds: string[];
    threadId: string;
  }): Promise<ThreadCollaborationView> {
    const thread = await this.requireThread(input.threadId);
    const access = await this.getAccess({
      actorUserId: input.actorUserId,
      departmentIds: input.departmentIds,
      thread
    });
    if (!access.canRead) {
      throw new Error("thread collaboration access denied");
    }

    const [shares, comments, state] = await Promise.all([
      this.deps.shares.listForThread(thread.id),
      this.deps.comments.listForThread(thread.id),
      this.deps.collaboration.getState(thread.id)
    ]);

    return {
      threadId: thread.id,
      ownerUserId: trimOrUndefined(thread.userId),
      access,
      shares,
      comments,
      assignment: state.assignment,
      followers: state.followers,
      captureMark: state.captureMark
    };
  }

  async replaceShares(input: {
    actorUserId: string;
    threadId: string;
    shares: Array<Omit<ThreadShareInput, "sharedByUserId" | "permissionLevel"> & { permissionLevel?: "read_comment" }>;
  }): Promise<ThreadShareRecord[]> {
    const thread = await this.requireThread(input.threadId);
    await this.assertCanManage(thread, input.actorUserId);

    const previousShares = await this.deps.shares.listForThread(thread.id);
    const previousRecipients = await this.resolveShareRecipients(previousShares);

    const normalizedShares = input.shares.map((share) => ({
      ...share,
      sharedByUserId: input.actorUserId,
      permissionLevel: "read_comment" as const
    }));
    const created = await this.deps.shares.replaceForThread(thread.id, normalizedShares, input.actorUserId);
    const recipients = difference(await this.resolveShareRecipients(created), previousRecipients);
    await this.project({
      eventType: "thread.shared",
      actorUserId: input.actorUserId,
      recipientUserIds: recipients,
      threadId: thread.id,
      title: "Thread shared",
      body: "A thread was shared with you for read/comment collaboration.",
      relatedEntityType: "thread",
      relatedEntityId: thread.id,
      payload: { shares: created }
    });
    return created;
  }

  async addComment(input: {
    actorUserId: string;
    threadId: string;
    bodyMarkdown: string;
    mentionedUserIds: string[];
  }): Promise<ThreadCommentRecord> {
    const thread = await this.requireThread(input.threadId);
    await this.assertCommentable(thread, input.actorUserId, undefined);
    await this.deps.directory?.ensureUsersExist?.(input.mentionedUserIds);

    const comment = await this.deps.comments.create({
      threadId: thread.id,
      authorUserId: input.actorUserId,
      bodyMarkdown: input.bodyMarkdown,
      mentionedUserIds: input.mentionedUserIds
    });
    const state = await this.deps.collaboration.getState(thread.id);
    const mentionedUserIds = await this.filterAccessibleUserIds(thread, uniqueUserIds(comment.mentionedUserIds));
    const participantRecipients = uniqueUserIds([
      trimOrUndefined(thread.userId) ?? "",
      state.assignment?.ownerUserId ?? "",
      ...state.followers.map((follower) => follower.userId)
    ]).filter((userId) => userId !== input.actorUserId && !mentionedUserIds.includes(userId));

    if (participantRecipients.length > 0) {
      await this.project({
        eventType: "thread.comment_added",
        actorUserId: input.actorUserId,
        recipientUserIds: participantRecipients,
        threadId: thread.id,
        title: "New thread comment",
        body: comment.bodyMarkdown,
        relatedEntityType: "thread_comment",
        relatedEntityId: comment.id,
        payload: { commentId: comment.id }
      });
    }
    if (mentionedUserIds.length > 0) {
      await this.project({
        eventType: "thread.mentioned",
        actorUserId: input.actorUserId,
        recipientUserIds: mentionedUserIds,
        threadId: thread.id,
        title: "You were mentioned on a thread",
        body: comment.bodyMarkdown,
        relatedEntityType: "thread_comment",
        relatedEntityId: comment.id,
        payload: { commentId: comment.id, mentionedUserIds }
      });
    }

    return comment;
  }

  async setAssignment(input: {
    actorUserId: string;
    threadId: string;
    ownerUserId: string;
    followerIds?: string[];
  }): Promise<Awaited<ReturnType<ThreadCollaborationRepository["getState"]>>>;
  async setAssignment(input: {
    actorUserId: string;
    threadId: string;
    ownerUserId: string;
    followerIds?: string[];
  }) {
    const thread = await this.requireThread(input.threadId);
    await this.assertCanManage(thread, input.actorUserId);
    const followerIds = input.followerIds ? uniqueUserIds(input.followerIds) : undefined;
    await this.deps.directory?.ensureUsersExist?.([input.ownerUserId, ...(followerIds ?? [])]);

    await this.deps.collaboration.setAssignment({
      threadId: thread.id,
      ownerUserId: input.ownerUserId,
      assignedByUserId: input.actorUserId
    });
    const followers =
      followerIds !== undefined
        ? await this.deps.collaboration.replaceFollowers(thread.id, followerIds, input.actorUserId)
        : (await this.deps.collaboration.getState(thread.id)).followers;

    await this.project({
      eventType: "thread.assigned",
      actorUserId: input.actorUserId,
      recipientUserIds: [input.ownerUserId],
      threadId: thread.id,
      title: "Thread assigned",
      body: "You were assigned as the collaboration owner.",
      relatedEntityType: "thread_assignment",
      relatedEntityId: thread.id,
      payload: { ownerUserId: input.ownerUserId }
    });
    if (followerIds !== undefined && followers.length > 0) {
      await this.project({
        eventType: "thread.follower_added",
        actorUserId: input.actorUserId,
        recipientUserIds: followers.map((follower) => follower.userId),
        threadId: thread.id,
        title: "Following thread updates",
        body: "You were added as a follower on a thread.",
        relatedEntityType: "thread_follower",
        relatedEntityId: thread.id,
        payload: { followerIds: followers.map((follower) => follower.userId) }
      });
    }
    return this.deps.collaboration.getState(thread.id);
  }

  async setFollowers(input: {
    actorUserId: string;
    threadId: string;
    followerIds: string[];
  }): Promise<{ followers: ThreadFollowerRecord[] }> {
    const thread = await this.requireThread(input.threadId);
    await this.assertCanManage(thread, input.actorUserId);
    await this.deps.directory?.ensureUsersExist?.(input.followerIds);

    const followers = await this.deps.collaboration.replaceFollowers(thread.id, input.followerIds, input.actorUserId);

    if (followers.length > 0) {
      await this.project({
        eventType: "thread.follower_added",
        actorUserId: input.actorUserId,
        recipientUserIds: followers.map((follower) => follower.userId),
        threadId: thread.id,
        title: "Following thread updates",
        body: "You were added as a follower on a thread.",
        relatedEntityType: "thread_follower",
        relatedEntityId: thread.id,
        payload: { followerIds: followers.map((follower) => follower.userId) }
      });
    }

    return { followers };
  }

  async setCaptureMark(input: {
    actorUserId: string;
    threadId: string;
    note?: string | null;
    enabled: boolean;
  }): Promise<ThreadCaptureMarkRecord | null> {
    const thread = await this.requireThread(input.threadId);
    await this.assertCanManage(thread, input.actorUserId);
    const captureMark = input.enabled
      ? await this.deps.collaboration.setCaptureMark({
          threadId: thread.id,
          status: "pending_capture",
          markedByUserId: input.actorUserId,
          note: input.note
        })
      : await this.deps.collaboration.setCaptureMark(null, thread.id);

    if (captureMark) {
      await this.project({
        eventType: "thread.capture_marked",
        actorUserId: input.actorUserId,
        recipientUserIds: [trimOrUndefined(thread.userId) ?? ""],
        threadId: thread.id,
        title: "Thread marked for capture",
        body: input.note?.trim() || "A thread was marked as pending capture.",
        relatedEntityType: "knowledge_capture_mark",
        relatedEntityId: captureMark.id,
        payload: { status: captureMark.status }
      });
    }
    return captureMark;
  }

  private async requireThread(threadId: string): Promise<ThreadRecord> {
    const thread = await this.deps.threads.get(threadId);
    if (!thread) {
      throw new Error("thread not found");
    }
    return thread;
  }

  private async assertCanManage(thread: ThreadRecord, actorUserId: string): Promise<void> {
    const ownerUserId = trimOrUndefined(thread.userId);
    const normalizedActorUserId = trimOrUndefined(actorUserId);
    if (ownerUserId && ownerUserId === normalizedActorUserId) {
      return;
    }
    const allowed = normalizedActorUserId
      ? await this.deps.authorizer?.canManageThreadCollaboration?.({
          actorUserId: normalizedActorUserId,
          threadId: thread.id,
          ownerUserId
        })
      : false;
    if (!allowed) {
      throw new Error("thread collaboration access denied");
    }
  }

  private async assertReadable(thread: ThreadRecord, actorUserId: string, departmentIds?: string[]): Promise<void> {
    const access = await this.getAccess({ actorUserId, departmentIds, thread });
    if (!access.canRead) {
      throw new Error("thread collaboration access denied");
    }
  }

  private async assertCommentable(thread: ThreadRecord, actorUserId: string, departmentIds?: string[]): Promise<void> {
    const access = await this.getAccess({ actorUserId, departmentIds, thread });
    if (!access.canComment) {
      throw new Error("thread collaboration access denied");
    }
  }

  private async getAccess(input: {
    actorUserId: string;
    departmentIds?: string[];
    thread: ThreadRecord;
  }): Promise<ThreadCollaborationView["access"]> {
    const actorUserId = trimOrUndefined(input.actorUserId);
    if (!actorUserId) {
      return { canRead: false, canComment: false, canRun: false, isOwner: false };
    }
    const ownerUserId = trimOrUndefined(input.thread.userId);
    const isOwner = ownerUserId === actorUserId;
    if (isOwner) {
      return { canRead: true, canComment: true, canRun: true, isOwner: true };
    }
    const adminReadable =
      (await this.deps.authorizer?.canReadThreadCollaboration?.({
        actorUserId,
        threadId: input.thread.id,
        ownerUserId
      })) ?? false;
    const adminCommentable =
      (await this.deps.authorizer?.canCommentThreadCollaboration?.({
        actorUserId,
        threadId: input.thread.id,
        ownerUserId
      })) ?? false;
    const adminManageable =
      (await this.deps.authorizer?.canManageThreadCollaboration?.({
        actorUserId,
        threadId: input.thread.id,
        ownerUserId
      })) ?? false;
    if (adminReadable || adminCommentable || adminManageable) {
      return {
        canRead: true,
        canComment: adminCommentable || adminManageable,
        canRun: false,
        isOwner: false
      };
    }
    const departmentIds =
      input.departmentIds ?? (this.deps.directory?.listDepartmentIdsForUser ? await this.deps.directory.listDepartmentIdsForUser(actorUserId) : []);
    const shares = await this.deps.shares.listEffectiveForUser({
      threadId: input.thread.id,
      userId: actorUserId,
      departmentIds
    });
    const shared = shares.length > 0;
    return {
      canRead: shared,
      canComment: shared,
      canRun: false,
      isOwner: false
    };
  }

  private async resolveShareRecipients(shares: ThreadShareRecord[]): Promise<string[]> {
    const recipients: string[] = [];
    for (const share of shares) {
      if (share.subjectType === "user") {
        recipients.push(share.subjectId);
        continue;
      }
      if (this.deps.directory?.listUserIdsForDepartment) {
        recipients.push(...(await this.deps.directory.listUserIdsForDepartment(share.subjectId)));
      }
    }
    return uniqueUserIds(recipients);
  }

  private async filterAccessibleUserIds(thread: ThreadRecord, userIds: string[]): Promise<string[]> {
    const accessible: string[] = [];
    for (const userId of uniqueUserIds(userIds)) {
      const access = await this.getAccess({
        actorUserId: userId,
        thread,
        departmentIds: this.deps.directory?.listDepartmentIdsForUser
          ? await this.deps.directory.listDepartmentIdsForUser(userId)
          : []
      });
      if (access.canRead) {
        accessible.push(userId);
      }
    }
    return accessible;
  }

  private async project(input: CollaborationInboxProjectionInput): Promise<void> {
    if (!this.deps.inboxProjection) return;
    await this.deps.inboxProjection.projectCollaborationEvent(input);
  }
}

function difference(next: string[], previous: string[]): string[] {
  const previousSet = new Set(previous);
  return next.filter((userId) => !previousSet.has(userId));
}
