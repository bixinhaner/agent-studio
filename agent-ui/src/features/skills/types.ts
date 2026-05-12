export type SkillDraftValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  metadata?: {
    name?: string;
    description?: string;
    hasScripts: boolean;
    fileCount: number;
    totalBytes: number;
  };
};

export type CodexSkillDraft = {
  id: string;
  organizationId?: string;
  createdByUserId: string;
  createdByDisplayName?: string;
  createdByEmail?: string;
  sourceThreadId?: string;
  sourceManagedSkillId?: string;
  requestedPrompt: string;
  skillName?: string;
  slug: string;
  displayName: string;
  description?: string;
  status: "pending_review" | "changes_requested" | "published" | "rejected" | "archived" | string;
  version: string;
  draftPath: string;
  publishedPath?: string;
  validation?: SkillDraftValidation;
  reviewNote?: string;
  reviewedByUserId?: string;
  reviewedByDisplayName?: string;
  publishedByUserId?: string;
  publishedByDisplayName?: string;
  publishedAt?: string;
  metadata?: unknown;
  createdAt: string;
  updatedAt: string;
};

export type CodexManagedSkill = {
  id: string;
  organizationId?: string;
  ownerUserId?: string;
  scope: string;
  skillName: string;
  slug: string;
  displayName: string;
  description?: string;
  status: string;
  version: string;
  checksum?: string;
  publishedPath: string;
  sourceDraftId?: string;
  createdByUserId?: string;
  createdByDisplayName?: string;
  createdByEmail?: string;
  reviewedByUserId?: string;
  reviewedByDisplayName?: string;
  publishedByUserId?: string;
  publishedByDisplayName?: string;
  metadata?: unknown;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
};
