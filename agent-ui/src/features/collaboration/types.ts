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
