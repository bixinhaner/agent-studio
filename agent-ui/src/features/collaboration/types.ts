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
export type BroadcastTestStatus = "not_tested" | "passed" | "failed" | "stale";
export type BroadcastLanguage = "zh" | "en";

export type TrainingCatalogConfiguration = {
  enabled: boolean;
  sourceEmail: string;
  rootFolderName: string;
  validationStatus: "valid" | "invalid" | "disabled";
  validationMessage: string;
  folderCount: number;
  threadCount: number;
  updatedAt?: string;
};

export type TrainingCatalogRootFolderOption = {
  id: string;
  name: string;
  workspaceId: string;
};

export type TrainingEnglishPrewarmStatus = {
  status: "idle" | "running" | "completed" | "failed";
  totalThreads: number;
  completedThreads: number;
  totalMessages: number;
  completedMessages: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
};

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
  channelEmailEnabled: boolean;
  channelInAppEnabled: boolean;
  channels: BroadcastChannels;
  content: BroadcastContent;
  audience: BroadcastAudienceConfig;
  audienceSnapshot?: BroadcastAudienceSnapshot;
  deliverySummary?: BroadcastDeliverySummary;
  testState: BroadcastTestState;
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
  channelEmailEnabled?: boolean;
  channelInAppEnabled?: boolean;
  dingtalkDeliveryEnabled?: boolean;
  content?: Partial<BroadcastContent>;
  audience?: BroadcastAudienceConfig;
  targets: BroadcastTargetInput[];
};

export type UpdateBroadcastDraftInput = {
  title?: string;
  bodyMarkdown?: string;
  channelEmailEnabled?: boolean;
  channelInAppEnabled?: boolean;
  dingtalkDeliveryEnabled?: boolean;
  content?: Partial<BroadcastContent>;
  audience?: BroadcastAudienceConfig;
  targets?: BroadcastTargetInput[];
};

export type BroadcastChannels = {
  email: boolean;
  inApp: boolean;
  dingtalk: boolean;
};

export type BroadcastContent = {
  subject: string;
  bodyMarkdown: string;
  ctaLabel?: string;
  ctaUrl?: string;
  language: BroadcastLanguage;
};

export type BroadcastAudienceRuleType =
  | "all_users"
  | "organization_type"
  | "organization"
  | "department"
  | "user"
  | "role"
  | "disabled_users"
  | "missing_email"
  | "email_opt_out";

export type BroadcastAudienceRule = {
  type: BroadcastAudienceRuleType;
  id?: string;
  value?: string;
  includeChildren?: boolean;
};

export type BroadcastAudienceConfig = {
  include: BroadcastAudienceRule[];
  exclude: BroadcastAudienceRule[];
};

export type BroadcastAudienceSnapshot = {
  recipientCount: number;
  emailReachableCount: number;
  internalCount: number;
  externalCount: number;
  excludedCount: number;
  sampleRecipients: BroadcastAudienceRecipient[];
  calculatedAt: string;
};

export type BroadcastAudienceRecipient = {
  userId: string;
  displayName?: string;
  email?: string;
  organizationName?: string;
  organizationType?: string;
};

export type BroadcastAudiencePreview = {
  recipients: BroadcastAudienceRecipient[];
  snapshot: BroadcastAudienceSnapshot;
  excluded: {
    disabled: number;
    missingEmail: number;
    emailOptOut: number;
    rules: number;
  };
};

export type BroadcastTestState = {
  status: BroadcastTestStatus;
  lastTestedAt?: string;
  lastFingerprint?: string;
};

export type BroadcastDeliverySummary = {
  recipientCount: number;
  emailSent: number;
  emailFailed: number;
  inAppSent: number;
  dingtalkSent: number;
  lastPublishedAt?: string;
};

export type BroadcastDeliveryRecord = {
  id: string;
  organizationId?: string;
  channelType: "in_app" | "dingtalk" | "email";
  targetRef: string;
  eventType: string;
  status: "pending" | "sent" | "failed";
  payload?: unknown;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};
