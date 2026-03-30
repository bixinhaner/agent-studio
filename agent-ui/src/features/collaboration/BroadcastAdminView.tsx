import { useEffect, useMemo, useState } from "react";

import {
  createBroadcastDraft,
  fetchAdminBroadcasts,
  publishBroadcast,
  updateBroadcastDraft
} from "./api";
import type {
  BroadcastRecord,
  BroadcastTargetInput,
  BroadcastTargetType
} from "./types";

type BroadcastDraft = {
  title: string;
  bodyMarkdown: string;
  targets: string;
  dingtalkDeliveryEnabled: boolean;
};

function formatLocalDateTime(value?: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function targetsToDraft(targets: BroadcastRecord["targets"]): string {
  return targets
    .map((target) => `${target.targetType}${target.targetId ? `:${target.targetId}` : ""}`)
    .join("\n");
}

function parseTargets(value: string): BroadcastTargetInput[] {
  const parsed: BroadcastTargetInput[] = [];
  const seen = new Set<string>();
  for (const line of value.split(/\n/g)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separatorIndex = trimmed.indexOf(":");
    const rawType = (separatorIndex >= 0 ? trimmed.slice(0, separatorIndex) : trimmed).trim();
    const rawId = separatorIndex >= 0 ? trimmed.slice(separatorIndex + 1).trim() : "";
    const targetType: BroadcastTargetType =
      rawType === "department" || rawType === "role" || rawType === "all_users" ? rawType : "all_users";
    const targetId = targetType === "all_users" ? undefined : rawId || undefined;
    const key = `${targetType}:${targetId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parsed.push({ targetType, targetId });
  }
  return parsed;
}

function buildEmptyDraft(): BroadcastDraft {
  return {
    title: "",
    bodyMarkdown: "",
    targets: "",
    dingtalkDeliveryEnabled: false
  };
}

function draftFromBroadcast(broadcast: BroadcastRecord): BroadcastDraft {
  return {
    title: broadcast.title,
    bodyMarkdown: broadcast.bodyMarkdown,
    targets: targetsToDraft(broadcast.targets),
    dingtalkDeliveryEnabled: broadcast.dingtalkDeliveryEnabled
  };
}

export function BroadcastAdminView() {
  const [broadcasts, setBroadcasts] = useState<BroadcastRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");
  const [publishedAtText, setPublishedAtText] = useState("");
  const [draft, setDraft] = useState<BroadcastDraft>(buildEmptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishingId, setPublishingId] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setErrorText("");
      try {
        const next = await fetchAdminBroadcasts();
        if (active) setBroadcasts(next);
      } catch (error) {
        if (active) setErrorText(error instanceof Error ? error.message : "加载广播列表失败");
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  const orderedBroadcasts = useMemo(
    () => [...broadcasts].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [broadcasts]
  );

  function resetForm() {
    setDraft(buildEmptyDraft());
    setEditingId(null);
  }

  async function handleSave() {
    setSaving(true);
    setErrorText("");
    setSuccessText("");
    try {
      const input = {
        title: draft.title,
        bodyMarkdown: draft.bodyMarkdown,
        dingtalkDeliveryEnabled: draft.dingtalkDeliveryEnabled,
        targets: parseTargets(draft.targets)
      };
      const next = editingId
        ? await updateBroadcastDraft(editingId, input)
        : await createBroadcastDraft(input);
      setBroadcasts((current) => {
        const exists = current.some((item) => item.id === next.id);
        return exists ? current.map((item) => (item.id === next.id ? next : item)) : [next, ...current];
      });
      setSuccessText(editingId ? "草稿已保存" : "草稿已创建");
      setPublishedAtText("");
      resetForm();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存广播草稿失败");
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish(broadcastId: string) {
    setPublishingId(broadcastId);
    setErrorText("");
    setSuccessText("");
    try {
      const next = await publishBroadcast(broadcastId);
      setBroadcasts((current) => current.map((item) => (item.id === broadcastId ? next : item)));
      if (editingId === broadcastId) {
        resetForm();
      }
      setSuccessText("广播已发布");
      setPublishedAtText(formatLocalDateTime(next.publishedAt));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "发布广播失败");
    } finally {
      setPublishingId("");
    }
  }

  return (
    <section className="admin-card broadcast-admin-shell">
      <div className="admin-section-header">
        <div>
          <h2>广播管理</h2>
          <p>维护系统广播草稿，确认目标范围后发布到通知中心。</p>
        </div>
      </div>

      <div className="broadcast-admin-grid">
        <section className="broadcast-admin-form">
          <div className="resource-center-section-header">
            <div>
              <h3>{editingId ? "编辑草稿" : "新建草稿"}</h3>
              <p>目标每行填写 `all_users`、`department:id` 或 `role:id`。</p>
            </div>
          </div>
          {errorText ? <p className="err-text">{errorText}</p> : null}
          {successText ? <p className="success-text">{successText}</p> : null}
          {publishedAtText ? (
            <p className="field-help">
              <span>已于</span> <span>{publishedAtText}</span> <span>发布</span>
            </p>
          ) : null}
          <div className="resource-center-form-grid">
            <label className="field resource-center-form-span-2">
              <span className="field-label">标题</span>
              <input
                className="field-input"
                value={draft.title}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              />
            </label>
            <label className="field resource-center-form-span-2">
              <span className="field-label">正文</span>
              <textarea
                className="field-input textarea collaboration-textarea"
                value={draft.bodyMarkdown}
                onChange={(event) => setDraft((current) => ({ ...current, bodyMarkdown: event.target.value }))}
              />
            </label>
            <label className="field resource-center-form-span-2">
              <span className="field-label">目标</span>
              <textarea
                className="field-input textarea collaboration-textarea"
                value={draft.targets}
                onChange={(event) => setDraft((current) => ({ ...current, targets: event.target.value }))}
              />
            </label>
            <label className="field checkbox-field">
              <span className="field-label">同步发送到钉钉</span>
              <input
                type="checkbox"
                checked={draft.dingtalkDeliveryEnabled}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, dingtalkDeliveryEnabled: event.target.checked }))
                }
              />
            </label>
          </div>
          <div className="resource-center-actions">
            <button type="button" className="admin-action-btn" disabled={saving} onClick={() => void handleSave()}>
              {editingId ? "保存草稿" : "新建草稿"}
            </button>
            {editingId ? (
              <button type="button" className="picker-btn" disabled={saving} onClick={resetForm}>
                取消编辑
              </button>
            ) : null}
          </div>
        </section>

        <section className="broadcast-admin-list">
          {loading ? <p className="field-help">加载广播列表中...</p> : null}
          {!loading && orderedBroadcasts.length === 0 ? <p className="field-help">还没有广播记录。</p> : null}
          <div className="broadcast-list">
            {orderedBroadcasts.map((broadcast) => (
              <article key={broadcast.id} className="broadcast-card">
                <div className="broadcast-card-head">
                  <div>
                    <strong>{broadcast.title}</strong>
                    <div className="config-tags">
                      <span className="tag">{broadcast.status}</span>
                      {broadcast.dingtalkDeliveryEnabled ? <span className="tag">dingtalk</span> : null}
                    </div>
                  </div>
                  <span className="field-help">{formatLocalDateTime(broadcast.updatedAt)}</span>
                </div>
                <p className="broadcast-card-body">{broadcast.bodyMarkdown}</p>
                <p className="field-help">
                  目标: {broadcast.targets.map((target) => `${target.targetType}${target.targetId ? `:${target.targetId}` : ""}`).join(", ")}
                </p>
                {broadcast.status === "published" && broadcast.publishedAt ? (
                  <p className="field-help">发布时间: {formatLocalDateTime(broadcast.publishedAt)}</p>
                ) : null}
                <div className="broadcast-card-actions">
                  {broadcast.status === "draft" ? (
                    <>
                      <button
                        type="button"
                        className="picker-btn"
                        onClick={() => {
                          setEditingId(broadcast.id);
                          setDraft(draftFromBroadcast(broadcast));
                          setSuccessText("");
                          setErrorText("");
                        }}
                      >
                        编辑 {broadcast.title}
                      </button>
                      <button
                        type="button"
                        className="admin-action-btn"
                        disabled={publishingId === broadcast.id}
                        onClick={() => void handlePublish(broadcast.id)}
                      >
                        发布 {broadcast.title}
                      </button>
                    </>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

export default BroadcastAdminView;
