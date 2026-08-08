import { api } from "../../lib/api";

import type {
  AddThreadCommentInput,
  BroadcastAudienceConfig,
  BroadcastAudiencePreview,
  BroadcastDeliveryRecord,
  BroadcastRecord,
  CreateBroadcastDraftInput,
  InboxItemRecord,
  ReplaceThreadSharesInput,
  SetThreadAssignmentInput,
  SetThreadCaptureMarkInput,
  ThreadCaptureMarkRecord,
  ThreadCollaborationView,
  ThreadCommentRecord,
  ThreadFollowerRecord,
  ThreadShareRecord,
  ThreadShareSubjectType,
  ThreadAssignmentRecord,
  TrainingCatalogConfiguration,
  TrainingCatalogRootFolderOption,
  TrainingEnglishPrewarmStatus,
  UpdateBroadcastDraftInput
} from "./types";

function trim(value: string): string {
  return value.trim();
}

export async function fetchThreadCollaboration(threadId: string): Promise<ThreadCollaborationView> {
  const response = await api<{ collaboration: ThreadCollaborationView }>(
    `/api/threads/${encodeURIComponent(trim(threadId))}/collaboration`
  );
  return response.collaboration;
}

export async function replaceThreadShares(
  threadId: string,
  shares: ReplaceThreadSharesInput[]
): Promise<ThreadShareRecord[]> {
  const response = await api<{ shares: ThreadShareRecord[] }>(
    `/api/threads/${encodeURIComponent(trim(threadId))}/shares`,
    {
      method: "PUT",
      json: {
        shares: shares.map((share) => ({
          subject_type: share.subjectType satisfies ThreadShareSubjectType,
          subject_id: trim(share.subjectId)
        }))
      }
    }
  );
  return response.shares;
}

export async function addThreadComment(
  threadId: string,
  input: AddThreadCommentInput
): Promise<ThreadCommentRecord> {
  const response = await api<{ comment: ThreadCommentRecord }>(
    `/api/threads/${encodeURIComponent(trim(threadId))}/comments`,
    {
      method: "POST",
      json: {
        body_markdown: trim(input.bodyMarkdown),
        mentioned_user_ids: (input.mentionedUserIds ?? []).map(trim).filter(Boolean)
      }
    }
  );
  return response.comment;
}

export async function setThreadAssignment(
  threadId: string,
  input: SetThreadAssignmentInput
): Promise<{ assignment: ThreadAssignmentRecord | null; followers: ThreadFollowerRecord[] }> {
  const followerIds = input.followerIds?.map(trim).filter(Boolean);
  const response = await api<{ assignment: ThreadAssignmentRecord | null; followers: ThreadFollowerRecord[] }>(
    `/api/threads/${encodeURIComponent(trim(threadId))}/assignment`,
    {
      method: "PUT",
      json: {
        owner_user_id: trim(input.ownerUserId),
        ...(followerIds ? { follower_ids: followerIds } : {})
      }
    }
  );
  return response;
}

export async function setThreadCaptureMark(
  threadId: string,
  input: SetThreadCaptureMarkInput
): Promise<ThreadCaptureMarkRecord | null> {
  const response = await api<{ captureMark: ThreadCaptureMarkRecord | null }>(
    `/api/threads/${encodeURIComponent(trim(threadId))}/capture-mark`,
    {
      method: "PUT",
      json: {
        enabled: input.enabled,
        note: trim(input.note ?? "") || null
      }
    }
  );
  return response.captureMark;
}

export async function fetchInboxItems(): Promise<InboxItemRecord[]> {
  const response = await api<{ items: InboxItemRecord[] }>("/api/inbox");
  return response.items;
}

async function updateInboxItemStatus(
  itemId: string,
  action: "read" | "unread" | "archive" | "unarchive"
): Promise<InboxItemRecord> {
  const response = await api<{ item: InboxItemRecord }>(`/api/inbox/${encodeURIComponent(trim(itemId))}/${action}`, {
    method: "POST"
  });
  return response.item;
}

export function markInboxItemRead(itemId: string): Promise<InboxItemRecord> {
  return updateInboxItemStatus(itemId, "read");
}

export function markInboxItemUnread(itemId: string): Promise<InboxItemRecord> {
  return updateInboxItemStatus(itemId, "unread");
}

export function archiveInboxItem(itemId: string): Promise<InboxItemRecord> {
  return updateInboxItemStatus(itemId, "archive");
}

export function unarchiveInboxItem(itemId: string): Promise<InboxItemRecord> {
  return updateInboxItemStatus(itemId, "unarchive");
}

function mapBroadcastInput(input: CreateBroadcastDraftInput | UpdateBroadcastDraftInput) {
  return {
    ...(input.title !== undefined ? { title: trim(input.title) } : {}),
    ...(input.bodyMarkdown !== undefined ? { body_markdown: trim(input.bodyMarkdown) } : {}),
    ...(input.channelEmailEnabled !== undefined ? { channel_email_enabled: input.channelEmailEnabled } : {}),
    ...(input.channelInAppEnabled !== undefined ? { channel_in_app_enabled: input.channelInAppEnabled } : {}),
    ...(input.dingtalkDeliveryEnabled !== undefined
      ? { dingtalk_delivery_enabled: input.dingtalkDeliveryEnabled }
      : {}),
    ...(input.content !== undefined
      ? {
          content: {
            ...(input.content.subject !== undefined ? { subject: trim(input.content.subject) } : {}),
            ...(input.content.bodyMarkdown !== undefined ? { body_markdown: trim(input.content.bodyMarkdown) } : {}),
            ...(input.content.ctaLabel !== undefined ? { cta_label: trim(input.content.ctaLabel) } : {}),
            ...(input.content.ctaUrl !== undefined ? { cta_url: trim(input.content.ctaUrl) } : {}),
            ...(input.content.language !== undefined ? { language: input.content.language } : {})
          }
        }
      : {}),
    ...(input.audience !== undefined ? { audience: mapAudienceInput(input.audience) } : {}),
    ...(input.targets !== undefined
      ? {
          targets: input.targets.map((target) => ({
            target_type: target.targetType,
            target_id: target.targetId ? trim(target.targetId) : null
          }))
        }
      : {})
  };
}

function mapAudienceInput(audience: BroadcastAudienceConfig) {
  return {
    include: audience.include.map((rule) => ({
      type: rule.type,
      ...(rule.id ? { id: trim(rule.id) } : {}),
      ...(rule.value ? { value: trim(rule.value) } : {}),
      ...(rule.includeChildren !== undefined ? { include_children: rule.includeChildren } : {})
    })),
    exclude: audience.exclude.map((rule) => ({
      type: rule.type,
      ...(rule.id ? { id: trim(rule.id) } : {}),
      ...(rule.value ? { value: trim(rule.value) } : {}),
      ...(rule.includeChildren !== undefined ? { include_children: rule.includeChildren } : {})
    }))
  };
}

export async function fetchAdminBroadcasts(status?: "draft" | "published" | "archived"): Promise<BroadcastRecord[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const response = await api<{ broadcasts: BroadcastRecord[] }>(`/api/admin/broadcasts${query}`);
  return response.broadcasts;
}

export async function createBroadcastDraft(input: CreateBroadcastDraftInput): Promise<BroadcastRecord> {
  const response = await api<{ broadcast: BroadcastRecord }>("/api/admin/broadcasts", {
    method: "POST",
    json: mapBroadcastInput(input)
  });
  return response.broadcast;
}

export async function updateBroadcastDraft(
  broadcastId: string,
  input: UpdateBroadcastDraftInput
): Promise<BroadcastRecord> {
  const response = await api<{ broadcast: BroadcastRecord }>(
    `/api/admin/broadcasts/${encodeURIComponent(trim(broadcastId))}`,
    {
      method: "PATCH",
      json: mapBroadcastInput(input)
    }
  );
  return response.broadcast;
}

export async function publishBroadcast(broadcastId: string): Promise<BroadcastRecord> {
  const response = await api<{ broadcast: BroadcastRecord }>(
    `/api/admin/broadcasts/${encodeURIComponent(trim(broadcastId))}/publish`,
    {
      method: "POST"
    }
  );
  return response.broadcast;
}

export async function previewBroadcastAudience(broadcastId: string): Promise<BroadcastAudiencePreview> {
  const response = await api<{ preview: BroadcastAudiencePreview }>(
    `/api/admin/broadcasts/${encodeURIComponent(trim(broadcastId))}/audience-preview`,
    {
      method: "POST"
    }
  );
  return response.preview;
}

export async function sendBroadcastTestEmail(input: {
  broadcastId: string;
  testEmail: string;
  simulatedUserId?: string;
}): Promise<{ broadcast: BroadcastRecord; delivered: boolean; mode: "smtp" | "debug" }> {
  return api<{ broadcast: BroadcastRecord; delivered: boolean; mode: "smtp" | "debug" }>(
    `/api/admin/broadcasts/${encodeURIComponent(trim(input.broadcastId))}/test-email`,
    {
      method: "POST",
      json: {
        test_email: trim(input.testEmail),
        ...(input.simulatedUserId ? { simulated_user_id: trim(input.simulatedUserId) } : {})
      }
    }
  );
}

export async function fetchBroadcastDeliveries(broadcastId: string): Promise<BroadcastDeliveryRecord[]> {
  const response = await api<{ deliveries: BroadcastDeliveryRecord[] }>(
    `/api/admin/broadcasts/${encodeURIComponent(trim(broadcastId))}/deliveries`
  );
  return response.deliveries;
}

function mapTrainingConfiguration(input: {
  enabled: boolean;
  source_email: string;
  root_folder_name: string;
  validation_status: TrainingCatalogConfiguration["validationStatus"];
  validation_message: string;
  folder_count: number;
  thread_count: number;
  updated_at?: string | null;
}): TrainingCatalogConfiguration {
  return {
    enabled: input.enabled,
    sourceEmail: input.source_email,
    rootFolderName: input.root_folder_name,
    validationStatus: input.validation_status,
    validationMessage: input.validation_message,
    folderCount: input.folder_count,
    threadCount: input.thread_count,
    updatedAt: input.updated_at ?? undefined
  };
}

export async function fetchTrainingCatalogConfiguration(): Promise<TrainingCatalogConfiguration> {
  const response = await api<{ configuration: Parameters<typeof mapTrainingConfiguration>[0] }>(
    "/api/admin/training-catalog/config"
  );
  return mapTrainingConfiguration(response.configuration);
}

export async function saveTrainingCatalogConfiguration(input: {
  enabled: boolean;
  sourceEmail: string;
  rootFolderName: string;
}): Promise<TrainingCatalogConfiguration> {
  const response = await api<{ configuration: Parameters<typeof mapTrainingConfiguration>[0] }>(
    "/api/admin/training-catalog/config",
    {
      method: "PUT",
      json: {
        enabled: input.enabled,
        source_email: trim(input.sourceEmail),
        root_folder_name: trim(input.rootFolderName)
      }
    }
  );
  return mapTrainingConfiguration(response.configuration);
}

export async function fetchTrainingRootFolders(sourceEmail: string): Promise<TrainingCatalogRootFolderOption[]> {
  const response = await api<{
    folders: Array<{ id: string; name: string; workspace_id: string }>;
  }>(`/api/admin/training-catalog/root-folders?source_email=${encodeURIComponent(trim(sourceEmail))}`);
  return response.folders.map((folder) => ({
    id: folder.id,
    name: folder.name,
    workspaceId: folder.workspace_id
  }));
}

function mapTrainingPrewarm(input: {
  status: TrainingEnglishPrewarmStatus["status"];
  total_threads: number;
  completed_threads: number;
  total_messages: number;
  completed_messages: number;
  started_at?: string | null;
  completed_at?: string | null;
  error?: string | null;
}): TrainingEnglishPrewarmStatus {
  return {
    status: input.status,
    totalThreads: input.total_threads,
    completedThreads: input.completed_threads,
    totalMessages: input.total_messages,
    completedMessages: input.completed_messages,
    startedAt: input.started_at ?? undefined,
    completedAt: input.completed_at ?? undefined,
    error: input.error ?? undefined
  };
}

export async function fetchTrainingEnglishPrewarm(): Promise<TrainingEnglishPrewarmStatus> {
  const response = await api<{ prewarm: Parameters<typeof mapTrainingPrewarm>[0] }>(
    "/api/admin/training-catalog/english-prewarm"
  );
  return mapTrainingPrewarm(response.prewarm);
}

export async function startTrainingEnglishPrewarm(): Promise<TrainingEnglishPrewarmStatus> {
  const response = await api<{ prewarm: Parameters<typeof mapTrainingPrewarm>[0] }>(
    "/api/admin/training-catalog/english-prewarm",
    { method: "POST" }
  );
  return mapTrainingPrewarm(response.prewarm);
}
