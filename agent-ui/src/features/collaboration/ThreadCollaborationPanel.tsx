import { useEffect, useMemo, useRef, useState } from "react";

import { addThreadComment, replaceThreadShares, setThreadAssignment, setThreadCaptureMark } from "./api";
import type {
  ThreadCollaborationView,
  ThreadShareSubjectType
} from "./types";

type ThreadCollaborationPanelProps = {
  threadId: string;
  collaboration: ThreadCollaborationView | null;
  loading: boolean;
  errorText: string;
  onCollaborationChange: (next: ThreadCollaborationView) => void;
};

type PendingAction = "shares" | "comment" | "assignment" | "capture" | null;

function formatLocalDateTime(value?: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function splitIds(value: string): string[] {
  return value
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseShareList(value: string): Array<{ subjectType: ThreadShareSubjectType; subjectId: string }> {
  const parsed: Array<{ subjectType: ThreadShareSubjectType; subjectId: string }> = [];
  for (const line of value.split(/\n/g)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separatorIndex = trimmed.indexOf(":");
    const prefix = separatorIndex >= 0 ? trimmed.slice(0, separatorIndex).trim() : "user";
    const subjectId = separatorIndex >= 0 ? trimmed.slice(separatorIndex + 1).trim() : trimmed;
    const subjectType: ThreadShareSubjectType = prefix === "department" ? "department" : "user";
    if (!subjectId) continue;
    parsed.push({ subjectType, subjectId });
  }
  return parsed;
}

function shareListValue(collaboration: ThreadCollaborationView | null): string {
  return (collaboration?.shares ?? []).map((share) => `${share.subjectType}:${share.subjectId}`).join("\n");
}

export function ThreadCollaborationPanel({
  threadId,
  collaboration,
  loading,
  errorText,
  onCollaborationChange
}: ThreadCollaborationPanelProps) {
  const [shareDraft, setShareDraft] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  const [mentionDraft, setMentionDraft] = useState("");
  const [ownerDraft, setOwnerDraft] = useState("");
  const [followersDraft, setFollowersDraft] = useState("");
  const [captureEnabled, setCaptureEnabled] = useState(false);
  const [captureNoteDraft, setCaptureNoteDraft] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [panelErrorText, setPanelErrorText] = useState("");
  const currentThreadIdRef = useRef(threadId);
  const latestCollaborationRef = useRef(collaboration);

  useEffect(() => {
    currentThreadIdRef.current = threadId;
    latestCollaborationRef.current = collaboration;
    setShareDraft(shareListValue(collaboration));
    setOwnerDraft(collaboration?.assignment?.ownerUserId ?? collaboration?.ownerUserId ?? "");
    setFollowersDraft((collaboration?.followers ?? []).map((follower) => follower.userId).join(", "));
    setCaptureEnabled(Boolean(collaboration?.captureMark));
    setCaptureNoteDraft(collaboration?.captureMark?.note ?? "");
    setPendingAction(null);
    setPanelErrorText("");
  }, [collaboration, threadId]);

  const readonlySharedThread = Boolean(collaboration && collaboration.access.canRead && !collaboration.access.canRun);
  const canManage = Boolean(collaboration?.access.canManage);
  const canComment = Boolean(collaboration?.access.canComment);

  const commentSummary = useMemo(() => {
    const count = collaboration?.comments.length ?? 0;
    if (count === 0) return "暂无协作评论";
    return `共 ${count} 条协作评论`;
  }, [collaboration?.comments.length]);

  async function handleShareSave() {
    if (!collaboration) return;
    const requestThreadId = threadId;
    setPendingAction("shares");
    setPanelErrorText("");
    try {
      const shares = await replaceThreadShares(threadId, parseShareList(shareDraft));
      if (currentThreadIdRef.current !== requestThreadId || !latestCollaborationRef.current) return;
      onCollaborationChange({ ...latestCollaborationRef.current, shares });
    } catch (error) {
      if (currentThreadIdRef.current === requestThreadId) {
        setPanelErrorText(error instanceof Error ? error.message : "更新共享失败");
      }
    } finally {
      if (currentThreadIdRef.current === requestThreadId) {
        setPendingAction(null);
      }
    }
  }

  async function handleCommentSubmit() {
    if (!collaboration || !commentDraft.trim()) return;
    const requestThreadId = threadId;
    setPendingAction("comment");
    setPanelErrorText("");
    try {
      const comment = await addThreadComment(threadId, {
        bodyMarkdown: commentDraft,
        mentionedUserIds: splitIds(mentionDraft)
      });
      if (currentThreadIdRef.current !== requestThreadId || !latestCollaborationRef.current) return;
      onCollaborationChange({
        ...latestCollaborationRef.current,
        comments: [...latestCollaborationRef.current.comments, comment]
      });
      if (currentThreadIdRef.current === requestThreadId) {
        setCommentDraft("");
        setMentionDraft("");
      }
    } catch (error) {
      if (currentThreadIdRef.current === requestThreadId) {
        setPanelErrorText(error instanceof Error ? error.message : "发送评论失败");
      }
    } finally {
      if (currentThreadIdRef.current === requestThreadId) {
        setPendingAction(null);
      }
    }
  }

  async function handleAssignmentSave() {
    if (!collaboration || !ownerDraft.trim()) return;
    const requestThreadId = threadId;
    setPendingAction("assignment");
    setPanelErrorText("");
    try {
      const next = await setThreadAssignment(threadId, {
        ownerUserId: ownerDraft,
        followerIds: splitIds(followersDraft)
      });
      if (currentThreadIdRef.current !== requestThreadId || !latestCollaborationRef.current) return;
      onCollaborationChange({
        ...latestCollaborationRef.current,
        assignment: next.assignment,
        followers: next.followers
      });
    } catch (error) {
      if (currentThreadIdRef.current === requestThreadId) {
        setPanelErrorText(error instanceof Error ? error.message : "保存协作负责人失败");
      }
    } finally {
      if (currentThreadIdRef.current === requestThreadId) {
        setPendingAction(null);
      }
    }
  }

  async function handleCaptureSave() {
    if (!collaboration) return;
    const requestThreadId = threadId;
    setPendingAction("capture");
    setPanelErrorText("");
    try {
      const captureMark = await setThreadCaptureMark(threadId, {
        enabled: captureEnabled,
        note: captureNoteDraft
      });
      if (currentThreadIdRef.current !== requestThreadId || !latestCollaborationRef.current) return;
      onCollaborationChange({
        ...latestCollaborationRef.current,
        captureMark
      });
    } catch (error) {
      if (currentThreadIdRef.current === requestThreadId) {
        setPanelErrorText(error instanceof Error ? error.message : "保存捕获标记失败");
      }
    } finally {
      if (currentThreadIdRef.current === requestThreadId) {
        setPendingAction(null);
      }
    }
  }

  return (
    <aside className="panel collaboration-panel" aria-label="线程协作面板">
      <div className="panel-title-row collaboration-panel-title-row">
        <div>
          <h2>协作</h2>
          <p className="collaboration-panel-subtitle">分享线程、记录评论、指定负责人、标记知识捕获。</p>
        </div>
        {threadId ? <span className="tag">{threadId}</span> : null}
      </div>

      {!threadId ? <p className="field-help">选择线程后加载协作状态。</p> : null}
      {loading ? <p className="field-help">协作状态加载中...</p> : null}
      {errorText ? <p className="err-text">{errorText}</p> : null}
      {panelErrorText ? <p className="err-text">{panelErrorText}</p> : null}
      {readonlySharedThread ? <p className="warn-text">共享视图中只能查看历史与发表评论，不能继续运行该线程。</p> : null}

      {collaboration ? (
        <div className="collaboration-panel-sections">
          <section className="collaboration-panel-section">
            <div className="collaboration-panel-section-head">
              <h3>共享范围</h3>
              <span className="field-help">每行 `user:id` 或 `department:id`</span>
            </div>
            <label className="field">
              <span className="field-label">共享对象</span>
              <textarea
                className="field-input textarea collaboration-textarea"
                value={shareDraft}
                onChange={(event) => setShareDraft(event.target.value)}
                disabled={!canManage || pendingAction === "shares"}
              />
            </label>
            <button
              type="button"
              className="picker-btn"
              onClick={() => void handleShareSave()}
              disabled={!canManage || pendingAction !== null}
            >
              更新共享
            </button>
          </section>

          <section className="collaboration-panel-section">
            <div className="collaboration-panel-section-head">
              <h3>协作评论</h3>
              <span className="field-help">{commentSummary}</span>
            </div>
            <div className="collaboration-comment-list">
              {(collaboration.comments ?? []).length > 0 ? (
                collaboration.comments.map((comment) => (
                  <article key={comment.id} className="collaboration-comment-card">
                    <div className="collaboration-comment-meta">
                      <strong>{comment.authorUserId || "未知用户"}</strong>
                      <span>{formatLocalDateTime(comment.createdAt)}</span>
                    </div>
                    <p>{comment.bodyMarkdown}</p>
                    {comment.mentionedUserIds.length > 0 ? (
                      <p className="field-help">提及: {comment.mentionedUserIds.join(", ")}</p>
                    ) : null}
                  </article>
                ))
              ) : (
                <p className="field-help">暂无评论。</p>
              )}
            </div>
            <label className="field">
              <span className="field-label">评论内容</span>
              <textarea
                className="field-input textarea collaboration-textarea"
                value={commentDraft}
                onChange={(event) => setCommentDraft(event.target.value)}
                disabled={!canComment || pendingAction === "comment"}
              />
            </label>
            <label className="field">
              <span className="field-label">提及用户 ID</span>
              <input
                className="field-input"
                value={mentionDraft}
                onChange={(event) => setMentionDraft(event.target.value)}
                placeholder="多个 ID 用逗号分隔"
                disabled={!canComment || pendingAction === "comment"}
              />
            </label>
            <button
              type="button"
              className="picker-btn"
              onClick={() => void handleCommentSubmit()}
              disabled={!canComment || !commentDraft.trim() || pendingAction !== null}
            >
              发送评论
            </button>
          </section>

          <section className="collaboration-panel-section">
            <div className="collaboration-panel-section-head">
              <h3>协作负责人</h3>
              <span className="field-help">负责人 1 人，关注人可多个</span>
            </div>
            <label className="field">
              <span className="field-label">协作负责人</span>
              <input
                className="field-input"
                value={ownerDraft}
                onChange={(event) => setOwnerDraft(event.target.value)}
                disabled={!canManage || pendingAction === "assignment"}
              />
            </label>
            <label className="field">
              <span className="field-label">关注人 ID</span>
              <input
                className="field-input"
                value={followersDraft}
                onChange={(event) => setFollowersDraft(event.target.value)}
                placeholder="多个 ID 用逗号分隔"
                disabled={!canManage || pendingAction === "assignment"}
              />
            </label>
            <button
              type="button"
              className="picker-btn"
              onClick={() => void handleAssignmentSave()}
              disabled={!canManage || !ownerDraft.trim() || pendingAction !== null}
            >
              保存协作人
            </button>
          </section>

          <section className="collaboration-panel-section">
            <div className="collaboration-panel-section-head">
              <h3>知识捕获</h3>
              <span className="field-help">标记高价值线程供后续沉淀</span>
            </div>
            <label className="field checkbox-field collaboration-capture-toggle">
              <span className="field-label">标记为待知识捕获</span>
              <input
                type="checkbox"
                checked={captureEnabled}
                onChange={(event) => setCaptureEnabled(event.target.checked)}
                disabled={!canManage || pendingAction === "capture"}
              />
            </label>
            <label className="field">
              <span className="field-label">捕获备注</span>
              <textarea
                className="field-input textarea collaboration-textarea"
                value={captureNoteDraft}
                onChange={(event) => setCaptureNoteDraft(event.target.value)}
                disabled={!canManage || pendingAction === "capture"}
              />
            </label>
            <button
              type="button"
              className="picker-btn"
              onClick={() => void handleCaptureSave()}
              disabled={!canManage || pendingAction !== null}
            >
              保存捕获标记
            </button>
          </section>
        </div>
      ) : null}
    </aside>
  );
}

export default ThreadCollaborationPanel;
