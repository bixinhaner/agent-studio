import { useEffect, useMemo, useState } from "react";
import { Typography, Input, Checkbox, Button, Space, Card, Spin, Empty, Tag, Alert, Row, Col } from "antd";
import { SendOutlined, EditOutlined, SaveOutlined } from "@ant-design/icons";

import { useIsNarrowScreen } from "../../lib/use-is-narrow-screen";
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
    const rawType = (separatorIndex >= 0 ? trimmed.slice(0, separatorIndex) : "").trim();
    const rawId = separatorIndex >= 0 ? trimmed.slice(separatorIndex + 1).trim() : "";
    let targetType: BroadcastTargetType;
    let targetId: string | undefined;

    if (trimmed === "all_users") {
      targetType = "all_users";
    } else if (rawType === "department" || rawType === "role") {
      if (!rawId) {
        throw new Error(`目标格式无效: ${trimmed}`);
      }
      targetType = rawType;
      targetId = rawId;
    } else {
      throw new Error(`目标格式无效: ${trimmed}`);
    }

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

function buildBroadcastInput(draft: BroadcastDraft) {
  return {
    title: draft.title,
    bodyMarkdown: draft.bodyMarkdown,
    dingtalkDeliveryEnabled: draft.dingtalkDeliveryEnabled,
    targets: parseTargets(draft.targets)
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
  const isNarrowScreen = useIsNarrowScreen(980);

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

  const summaryItems = useMemo(() => {
    const draftCount = broadcasts.filter((item) => item.status === "draft").length;
    const publishedCount = broadcasts.filter((item) => item.status === "published").length;
    const dingtalkCount = broadcasts.filter((item) => item.dingtalkDeliveryEnabled).length;

    return [
      {
        label: "广播总数",
        value: String(broadcasts.length),
        meta: "包含草稿与已发布记录"
      },
      {
        label: "待发布草稿",
        value: String(draftCount),
        meta: "仍可继续编辑或审核"
      },
      {
        label: "已发布",
        value: String(publishedCount),
        meta: "已经同步到通知中心"
      },
      {
        label: "钉钉触达",
        value: String(dingtalkCount),
        meta: "启用了钉钉推送的广播"
      }
    ];
  }, [broadcasts]);

  function resetForm() {
    setDraft(buildEmptyDraft());
    setEditingId(null);
  }

  async function handleSave() {
    setSaving(true);
    setErrorText("");
    setSuccessText("");
    try {
      const input = buildBroadcastInput(draft);
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
      let publishTargetId = broadcastId;
      if (editingId === broadcastId) {
        const savedDraft = await updateBroadcastDraft(broadcastId, buildBroadcastInput(draft));
        publishTargetId = savedDraft.id;
        setBroadcasts((current) => current.map((item) => (item.id === savedDraft.id ? savedDraft : item)));
      }
      const next = await publishBroadcast(publishTargetId);
      setBroadcasts((current) => current.map((item) => (item.id === publishTargetId ? next : item)));
      if (editingId === publishTargetId) {
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
    <div className="admin-page-container">
      <div className="admin-page-header">
        <div>
          <Typography.Title level={3} style={{ margin: 0, marginBottom: 8 }}>
            广播管理
          </Typography.Title>
          <Typography.Text type="secondary">维护系统广播草稿，确认目标范围后发布到通知中心。</Typography.Text>
        </div>
        <Space wrap>
          <Tag color="blue" style={{ borderRadius: "var(--admin-radius-full)" }}>
            本地时区展示
          </Tag>
        </Space>
      </div>

      {errorText ? <Alert type="error" showIcon message={errorText} style={{ marginBottom: 16 }} /> : null}
      {successText ? <Alert type="success" showIcon message={successText} style={{ marginBottom: 16 }} /> : null}

      <div className="admin-page-summary-grid">
        {summaryItems.map((item) => (
          <section key={item.label} className="admin-page-summary-card">
            <div className="admin-page-summary-label">{item.label}</div>
            <div className="admin-page-summary-value">{item.value}</div>
            <div className="admin-page-summary-meta">{item.meta}</div>
          </section>
        ))}
      </div>
      
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={10}>
          <Card 
            title={editingId ? "编辑草稿" : "新建草稿"} 
            className="antd-admin-card"
            extra={publishedAtText && <span style={{ color: 'var(--admin-color-subtle)', fontSize: 12 }}>已发布于 {publishedAtText}</span>}
            bodyStyle={{ padding: '20px 24px' }}
          >
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <div>
                <div style={{ marginBottom: 8, fontWeight: 500 }}>标题</div>
                <Input
                  value={draft.title}
                  onChange={(e) => setDraft(curr => ({ ...curr, title: e.target.value }))}
                  placeholder="广播标题"
                />
              </div>
              
              <div>
                <div style={{ marginBottom: 8, fontWeight: 500 }}>正文 (Markdown)</div>
                <Input.TextArea
                  rows={8}
                  value={draft.bodyMarkdown}
                  onChange={(e) => setDraft(curr => ({ ...curr, bodyMarkdown: e.target.value }))}
                  placeholder="广播详细内容"
                />
              </div>
              
              <div>
                <div style={{ marginBottom: 8, fontWeight: 500 }}>目标范围</div>
                <Input.TextArea
                  rows={4}
                  value={draft.targets}
                  onChange={(e) => setDraft(curr => ({ ...curr, targets: e.target.value }))}
                  placeholder="每行填写: all_users, department:id 或 role:id"
                />
                <Typography.Paragraph type="secondary" style={{ margin: "8px 0 0", fontSize: 12 }}>
                  支持按全员、部门或角色定向发布，多个目标请分行输入。
                </Typography.Paragraph>
              </div>
              
              <Checkbox
                checked={draft.dingtalkDeliveryEnabled}
                onChange={(e) => setDraft(curr => ({ ...curr, dingtalkDeliveryEnabled: e.target.checked }))}
              >
                同步发送到钉钉
              </Checkbox>
              
              <div style={{ marginTop: 8, display: 'flex', gap: 12 }}>
                <Button 
                  type="primary" 
                  icon={<SaveOutlined />} 
                  onClick={() => void handleSave()} 
                  loading={saving}
                  style={{ borderRadius: 'var(--admin-radius-full)' }}
                >
                  {editingId ? "保存草稿" : "新建草稿"}
                </Button>
                {editingId && (
                  <Button onClick={resetForm} disabled={saving} style={{ borderRadius: 'var(--admin-radius-full)' }}>
                    取消编辑
                  </Button>
                )}
              </div>
            </Space>
          </Card>
        </Col>

        <Col xs={24} lg={14}>
          <Card 
            title="广播记录" 
            className="antd-admin-card"
            bodyStyle={{ padding: 0 }}
          >
            {loading ? (
              <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>
            ) : orderedBroadcasts.length === 0 ? (
              <Empty description="还没有广播记录" style={{ padding: 40 }} />
            ) : (
              <div style={{ maxHeight: isNarrowScreen ? "none" : "calc(100vh - 520px)", overflowY: "auto" }}>
                {orderedBroadcasts.map((broadcast) => (
                  <div 
                    key={broadcast.id} 
                    style={{ 
                      padding: '16px 24px', 
                      borderBottom: '1px solid var(--admin-color-border)',
                      background: broadcast.status === 'draft' ? 'var(--admin-color-surface)' : 'transparent',
                      transition: 'background 0.2s'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{broadcast.title}</div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <Tag color={broadcast.status === 'published' ? 'success' : 'warning'} style={{ margin: 0, borderRadius: 4 }}>
                            {broadcast.status === 'published' ? '已发布' : '草稿'}
                          </Tag>
                          {broadcast.dingtalkDeliveryEnabled && <Tag color="processing" style={{ margin: 0, borderRadius: 4 }}>钉钉</Tag>}
                          <span style={{ color: 'var(--admin-color-subtle)', fontSize: 12 }}>
                            {formatLocalDateTime(broadcast.updatedAt)}
                          </span>
                        </div>
                      </div>
                      
                      {broadcast.status === "draft" && (
                        <Space wrap>
                          <Button 
                            size="small" 
                            icon={<EditOutlined />} 
                            onClick={() => {
                              setEditingId(broadcast.id);
                              setDraft(draftFromBroadcast(broadcast));
                              setSuccessText("");
                              setErrorText("");
                            }}
                            style={{ borderRadius: 'var(--admin-radius-full)' }}
                          >
                            编辑
                          </Button>
                          <Button 
                            size="small" 
                            type="primary" 
                            icon={<SendOutlined />} 
                            loading={publishingId === broadcast.id}
                            onClick={() => void handlePublish(broadcast.id)}
                            style={{ borderRadius: 'var(--admin-radius-full)' }}
                          >
                            发布
                          </Button>
                        </Space>
                      )}
                    </div>
                    
                    <Typography.Paragraph 
                      ellipsis={{ rows: 2, expandable: true, symbol: '展开' }}
                      style={{ color: 'var(--admin-color-text)', marginBottom: 8, fontSize: 13 }}
                    >
                      {broadcast.bodyMarkdown}
                    </Typography.Paragraph>
                    
                    <div style={{ fontSize: 12, color: 'var(--admin-color-subtle)' }}>
                      <div>目标: {broadcast.targets.map(t => `${t.targetType}${t.targetId ? `:${t.targetId}` : ""}`).join(", ")}</div>
                      {broadcast.status === "published" && broadcast.publishedAt && (
                        <div>发布于: {formatLocalDateTime(broadcast.publishedAt)}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}

export default BroadcastAdminView;
