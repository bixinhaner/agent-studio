import { useEffect, useMemo, useState } from "react";
import { Typography, Tag, Segmented, Spin, Empty, Alert, Button, Space } from "antd";
import { ReloadOutlined, CheckOutlined, InboxOutlined } from "@ant-design/icons";

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
  const [reloadNonce, setReloadNonce] = useState(0);

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
  }, [reloadNonce]);

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

  const unreadCount = items.filter(item => item.status === 'unread').length;

  return (
    <div className="admin-page-container">
      <div className="admin-page-header">
        <div>
          <Typography.Title level={3} style={{ margin: 0, marginBottom: 8 }}>
            通知中心
          </Typography.Title>
          <Typography.Text type="secondary">统一处理协作动态、告警事件和系统广播。</Typography.Text>
        </div>
        <Space>
          <Tag color={unreadCount > 0 ? "processing" : "default"} style={{ borderRadius: 'var(--admin-radius-full)' }}>
            {unreadCount} 条未读
          </Tag>
          <Button icon={<ReloadOutlined />} onClick={() => setReloadNonce(n => n + 1)} loading={loading}>
            刷新
          </Button>
        </Space>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Segmented
          value={activeTab}
          options={TABS.map((item) => ({ label: item.label, value: item.id }))}
          onChange={(value) => setActiveTab(value as InboxTab)}
          style={{ padding: 4, background: 'var(--admin-color-surface)' }}
        />
      </div>

      {errorText ? <Alert type="error" showIcon message={errorText} style={{ marginBottom: 16 }} /> : null}

      <div style={{ 
        background: 'var(--admin-color-surface-solid)', 
        borderRadius: 'var(--admin-radius-lg)', 
        border: '1px solid var(--admin-color-border)',
        boxShadow: 'var(--admin-shadow-sm)',
        minHeight: '400px'
      }}>
        {loading ? (
          <div style={{ padding: '60px 0', textAlign: 'center' }}>
            <Spin size="large" />
          </div>
        ) : filteredItems.length === 0 ? (
          <Empty 
            image={Empty.PRESENTED_IMAGE_SIMPLE} 
            description="当前筛选下暂无消息" 
            style={{ padding: '60px 0' }}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', padding: '12px' }}>
            {filteredItems.map((item) => {
              const busy = pendingItemIds.includes(item.id);
              const isUnread = item.status === "unread";
              
              return (
                <div 
                  key={item.id} 
                  style={{
                    padding: '16px',
                    borderBottom: '1px solid var(--admin-color-border)',
                    background: isUnread ? 'var(--admin-color-accent-soft)' : 'transparent',
                    borderRadius: 'var(--admin-radius-md)',
                    marginBottom: '4px',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      {isUnread && <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--admin-color-accent)' }} />}
                      <strong style={{ fontSize: '15px', color: 'var(--admin-color-text)' }}>{item.title}</strong>
                      <Tag color={item.category === 'alert' ? 'error' : item.category === 'collaboration' ? 'processing' : 'default'} style={{ margin: 0, borderRadius: 4 }}>
                        {item.category}
                      </Tag>
                    </div>
                    <span style={{ fontSize: '12px', color: 'var(--admin-color-subtle)' }}>
                      {formatLocalDateTime(item.createdAt)}
                    </span>
                  </div>
                  
                  <p style={{ margin: '0 0 12px 0', color: 'var(--admin-color-text)', fontSize: '14px', paddingLeft: isUnread ? '20px' : '0' }}>
                    {item.body}
                  </p>
                  
                  <div style={{ display: 'flex', gap: '8px', paddingLeft: isUnread ? '20px' : '0' }}>
                    {item.status === "unread" && (
                      <Button 
                        size="small" 
                        type="primary"
                        ghost
                        icon={<CheckOutlined />} 
                        loading={busy} 
                        onClick={() => void applyItemUpdate(item.id, markInboxItemRead)}
                        style={{ borderRadius: 'var(--admin-radius-full)' }}
                      >
                        标记已读
                      </Button>
                    )}
                    {item.status === "read" && (
                      <Button 
                        size="small" 
                        loading={busy} 
                        onClick={() => void applyItemUpdate(item.id, markInboxItemUnread)}
                        style={{ borderRadius: 'var(--admin-radius-full)' }}
                      >
                        标记未读
                      </Button>
                    )}
                    {item.status !== "archived" && (
                      <Button 
                        size="small" 
                        icon={<InboxOutlined />}
                        loading={busy} 
                        onClick={() => void applyItemUpdate(item.id, archiveInboxItem)}
                        style={{ borderRadius: 'var(--admin-radius-full)' }}
                      >
                        归档
                      </Button>
                    )}
                    {item.status === "archived" && (
                      <Button 
                        size="small" 
                        loading={busy} 
                        onClick={() => void applyItemUpdate(item.id, unarchiveInboxItem)}
                        style={{ borderRadius: 'var(--admin-radius-full)' }}
                      >
                        取消归档
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default InboxShell;
