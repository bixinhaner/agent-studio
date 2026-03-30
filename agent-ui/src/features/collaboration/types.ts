export type ThreadCollaborationAccess = {
  canRead: boolean;
  canComment: boolean;
  canRun: boolean;
  isOwner: boolean;
  canManage: boolean;
};

export type ThreadShareSubjectType = "user" | "department";
export type ThreadSharePermissionLevel = "read_comment";

export type ThreadShareRecord = {
  id: string;
  threadId: string;
  subjectType: ThreadShareSubjectType;
  subjectId: string;
  permissionLevel: ThreadSharePermissionLevel;
  sharedByUserId?: string;
  revokedByUserId?: string;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type ThreadCommentRecord = {
  id: string;
  threadId: string;
  authorUserId?: string;
  bodyMarkdown: string;
  mentionedUserIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type ThreadAssignmentRecord = {
  id: string;
  threadId: string;
  ownerUserId: string;
  assignedByUserId?: string;
  assignedAt: string;
  updatedAt: string;
};

export type ThreadFollowerRecord = {
  id: string;
  threadId: string;
  userId: string;
  addedByUserId?: string;
  createdAt: string;
};

export type ThreadCaptureMarkRecord = {
  id: string;
  threadId: string;
  status: string;
  markedByUserId?: string;
  markedAt: string;
  note?: string;
  updatedAt: string;
};

export type ThreadCollaborationView = {
  threadId: string;
  ownerUserId?: string;
  access: ThreadCollaborationAccess;
  shares: ThreadShareRecord[];
  comments: ThreadCommentRecord[];
  assignment: ThreadAssignmentRecord | null;
  followers: ThreadFollowerRecord[];
  captureMark: ThreadCaptureMarkRecord | null;
};

export type ReplaceThreadSharesInput = {
  subjectType: ThreadShareSubjectType;
  subjectId: string;
};

export type AddThreadCommentInput = {
  bodyMarkdown: string;
  mentionedUserIds?: string[];
};

export type SetThreadAssignmentInput = {
  ownerUserId: string;
  followerIds?: string[];
};

export type SetThreadCaptureMarkInput = {
  enabled: boolean;
  note?: string;
};

export type InboxCategory = "collaboration" | "alert" | "broadcast";
export type InboxItemStatus = "unread" | "read" | "archived";

export type InboxItemRecord = {
  id: string;
  userId: string;
  eventType: string;
  category: InboxCategory;
  title: string;
  body: string;
  status: InboxItemStatus;
  threadId?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  sourceActorUserId?: string;
  payload?: unknown;
  readAt?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type BroadcastTargetType = "all_users" | "department" | "role";
export type BroadcastStatus = "draft" | "published" | "archived";

export type BroadcastTargetRecord = {
  id: string;
  broadcastId: string;
  targetType: BroadcastTargetType;
  targetId?: string;
  createdAt: string;
};

export type BroadcastRecord = {
  id: string;
  title: string;
  bodyMarkdown: string;
  status: BroadcastStatus;
  createdByUserId?: string;
  publishedAt?: string;
  publishedByUserId?: string;
  dingtalkDeliveryEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  targets: BroadcastTargetRecord[];
};

export type BroadcastTargetInput = {
  targetType: BroadcastTargetType;
  targetId?: string;
};

export type CreateBroadcastDraftInput = {
  title: string;
  bodyMarkdown: string;
  dingtalkDeliveryEnabled?: boolean;
  targets: BroadcastTargetInput[];
};

export type UpdateBroadcastDraftInput = {
  title?: string;
  bodyMarkdown?: string;
  dingtalkDeliveryEnabled?: boolean;
  targets?: BroadcastTargetInput[];
};
