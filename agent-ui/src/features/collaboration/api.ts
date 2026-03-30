import { api } from "../../lib/api";

import type {
  AddThreadCommentInput,
  ReplaceThreadSharesInput,
  SetThreadAssignmentInput,
  SetThreadCaptureMarkInput,
  ThreadCaptureMarkRecord,
  ThreadCollaborationView,
  ThreadCommentRecord,
  ThreadFollowerRecord,
  ThreadShareRecord,
  ThreadShareSubjectType,
  ThreadAssignmentRecord
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
