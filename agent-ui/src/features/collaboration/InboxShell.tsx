import { useEffect, useMemo, useState } from "react";

import {
  archiveInboxItem,
  fetchInboxItems,
  markInboxItemRead,
  markInboxItemUnread,
  unarchiveInboxItem
} from "./api";
import type { InboxCategory, InboxItemRecord } from "./types";

type InboxTab = "all" | InboxCategory;

const TABS: Array<{ id: InboxTab; label: string }> = [
  { id: "all", label: "全部" },
  { id: "collaboration", label: "协作" },
  { id: "alert", label: "告警" },
  { id: "broadcast", label: "广播" }
];

function formatLocalDateTime(value?: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function statusLabel(item: InboxItemRecord): string {
  if (item.status === "archived") return "已归档";
  if (item.status === "read") return "已读";
  return "未读";
}

export function InboxShell() {
  const [items, setItems] = useState<InboxItemRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [activeTab, setActiveTab] = useState<InboxTab>("all");
  const [pendingItemIds, setPendingItemIds] = useState<string[]>([]);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setErrorText("");
      try {
        const next = await fetchInboxItems();
        if (active) setItems(next);
      } catch (error) {
        if (active) setErrorText(error instanceof Error ? error.message : "加载通知中心失败");
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  const filteredItems = useMemo(() => {
    if (activeTab === "all") return items;
    return items.filter((item) => {
      if (item.category !== activeTab) return false;
      if (activeTab === "alert" && item.status === "archived") return false;
      return true;
    });
  }, [activeTab, items]);

  async function applyItemUpdate(itemId: string, action: (targetItemId: string) => Promise<InboxItemRecord>) {
    setPendingItemIds((current) => (current.includes(itemId) ? current : [...current, itemId]));
    setErrorText("");
    try {
      const next = await action(itemId);
      setItems((current) => current.map((item) => (item.id === itemId ? next : item)));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "更新通知状态失败");
    } finally {
      setPendingItemIds((current) => current.filter((currentItemId) => currentItemId !== itemId));
    }
  }

  return (
    <section className="admin-card inbox-shell">
      <div className="inbox-shell-header">
        <div>
          <h2>通知中心</h2>
          <p>统一处理协作动态、告警事件和系统广播。</p>
        </div>
      </div>

      <div className="inbox-tabs" role="tablist" aria-label="通知分类">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? "resource-center-type-tab active" : "resource-center-type-tab"}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? <p className="field-help">加载通知中心中...</p> : null}
      {errorText ? <p className="err-text">{errorText}</p> : null}

      <div className="inbox-list">
        {!loading && filteredItems.length === 0 ? <p className="field-help">当前筛选下暂无消息。</p> : null}
        {filteredItems.map((item) => {
          const busy = pendingItemIds.includes(item.id);
          return (
            <article key={item.id} className={`inbox-card inbox-card-${item.status}`}>
              <div className="inbox-card-header">
                <div className="inbox-card-title-group">
                  <strong>{item.title}</strong>
                  <div className="config-tags">
                    <span className="tag">{statusLabel(item)}</span>
                    <span className="tag">{item.category}</span>
                    {item.threadId ? <span className="tag">{item.threadId}</span> : null}
                  </div>
                </div>
                <span className="field-help">{formatLocalDateTime(item.createdAt)}</span>
              </div>
              <p className="inbox-card-body">{item.body}</p>
              <div className="inbox-card-actions">
                {item.status === "unread" ? (
                  <button
                    type="button"
                    className="picker-btn"
                    disabled={busy}
                    onClick={() => void applyItemUpdate(item.id, markInboxItemRead)}
                  >
                    标记已读
                  </button>
                ) : null}
                {item.status === "read" ? (
                  <button
                    type="button"
                    className="picker-btn"
                    disabled={busy}
                    onClick={() => void applyItemUpdate(item.id, markInboxItemUnread)}
                  >
                    标记未读
                  </button>
                ) : null}
                {item.status === "archived" ? (
                  <button
                    type="button"
                    className="picker-btn"
                    disabled={busy}
                    onClick={() => void applyItemUpdate(item.id, unarchiveInboxItem)}
                  >
                    取消归档
                  </button>
                ) : (
                  <button
                    type="button"
                    className="picker-btn"
                    disabled={busy}
                    onClick={() => void applyItemUpdate(item.id, archiveInboxItem)}
                  >
                    归档
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default InboxShell;
