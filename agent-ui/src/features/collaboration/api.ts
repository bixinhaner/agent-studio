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
