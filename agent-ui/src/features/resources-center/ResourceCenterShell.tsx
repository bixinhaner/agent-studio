import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  message,
  Select,
  Space,
  Spin,
  Tag,
  Typography
} from "antd";
import { useEffect, useMemo, useState } from "react";

import { MobileFilterDrawer } from "../admin/components/MobileFilterDrawer";
import { deepEqual, normalizeRecordForCompare } from "../../lib/object-utils";
import { useIsNarrowScreen } from "../../lib/use-is-narrow-screen";
import { openWarningConfirm } from "../../lib/warning-modal";
import { createKnowledgeSet, fetchKnowledgeSets } from "./api";
import { KnowledgeSetDetailView } from "./KnowledgeSetDetailView";
import type { KnowledgeSetRecord, ResourceStatusFilter } from "./types";

type CreatePanelState = {
  name: string;
  description: string;
};

const STATUS_FILTER_OPTIONS: Array<{ label: string; value: ResourceStatusFilter }> = [
  { label: "全部状态", value: "all" },
  { label: "启用中", value: "active" },
  { label: "已禁用", value: "disabled" }
];

function matchesSearch(input: string, values: Array<string | undefined>) {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return true;
  return values.some((value) => (value || "").toLowerCase().includes(normalized));
}

function formatLocalDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function createInitialPanelState(): CreatePanelState {
  return {
    name: "",
    description: ""
  };
}

function knowledgeSetCardSummary(knowledgeSet: KnowledgeSetRecord): string {
  const description = knowledgeSet.description?.trim();
  if (description) return description;
  return "创建后可在详情中上传文件或压缩包。";
}

export function ResourceCenterShell() {
  const [knowledgeSets, setKnowledgeSets] = useState<KnowledgeSetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ResourceStatusFilter>("all");
  const [selectedKnowledgeSetId, setSelectedKnowledgeSetId] = useState<string | null>(null);
  const [createPanelOpen, setCreatePanelOpen] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [createErrorText, setCreateErrorText] = useState("");
  const [reloadNonce, setReloadNonce] = useState(0);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [createInitialValues, setCreateInitialValues] = useState<CreatePanelState>(createInitialPanelState());
  const [createForm] = Form.useForm<CreatePanelState>();
  const isNarrowScreen = useIsNarrowScreen(980);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setErrorText("");
      try {
        const response = await fetchKnowledgeSets();
        if (!active) return;
        setKnowledgeSets(response.knowledgeSets);
      } catch (error) {
        if (active) {
          setErrorText(error instanceof Error ? error.message : "加载资料配置中心失败");
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [reloadNonce]);

  const filteredKnowledgeSets = useMemo(() => {
    const matched = knowledgeSets.filter((knowledgeSet) => {
      if (statusFilter !== "all" && knowledgeSet.status !== statusFilter) return false;
      return matchesSearch(search, [knowledgeSet.name, knowledgeSet.slug, knowledgeSet.description]);
    });
    return matched.sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt);
      const rightTime = Date.parse(right.updatedAt);
      if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
        return left.name.localeCompare(right.name, "zh-CN");
      }
      return rightTime - leftTime;
    });
  }, [knowledgeSets, search, statusFilter]);

  const selectedKnowledgeSet = filteredKnowledgeSets.find((item) => item.id === selectedKnowledgeSetId) ?? null;

  useEffect(() => {
    if (createPanelOpen) return;
    if (filteredKnowledgeSets.length === 0) {
      setSelectedKnowledgeSetId(null);
      return;
    }
    const stillExists = filteredKnowledgeSets.some((item) => item.id === selectedKnowledgeSetId);
    if (!stillExists) {
      setSelectedKnowledgeSetId(filteredKnowledgeSets[0].id);
    }
  }, [createPanelOpen, filteredKnowledgeSets, selectedKnowledgeSetId]);

  const activeListCount = filteredKnowledgeSets.length;
  const activeEnabledCount = filteredKnowledgeSets.filter((item) => item.status === "active").length;
  const activeDisabledCount = Math.max(activeListCount - activeEnabledCount, 0);
  const mobileFilterCount = (search.trim() ? 1 : 0) + (statusFilter !== "all" ? 1 : 0);
  const managedUploadCount = filteredKnowledgeSets.filter((item) => item.sourceType === "managed_upload").length;
  const recentChangeCount = filteredKnowledgeSets.filter((item) => {
    const updatedAt = Date.parse(item.updatedAt);
    if (Number.isNaN(updatedAt)) return false;
    return Date.now() - updatedAt <= 7 * 24 * 60 * 60 * 1000;
  }).length;
  const selectionLabel = selectedKnowledgeSet ? `${selectedKnowledgeSet.name} · ${selectedKnowledgeSet.status}` : "未选择资料集";
  const filterScopeLabel = search.trim() ? `搜索“${search.trim()}”` : "全量资料视图";

  function handleKnowledgeSetUpdated(updatedKnowledgeSet: KnowledgeSetRecord) {
    setKnowledgeSets((current) =>
      current.map((knowledgeSet) => (knowledgeSet.id === updatedKnowledgeSet.id ? updatedKnowledgeSet : knowledgeSet))
    );
  }

  function handleKnowledgeSetDeleted(knowledgeSetId: string, warnings?: string[]) {
    setKnowledgeSets((current) => current.filter((knowledgeSet) => knowledgeSet.id !== knowledgeSetId));
    setSelectedKnowledgeSetId((current) => (current === knowledgeSetId ? null : current));
    setMobileDetailOpen(false);
    setErrorText("");
    if (Array.isArray(warnings) && warnings.length > 0) {
      const warningMessage = warnings.map((item) => item.trim()).filter(Boolean).join("；");
      if (warningMessage) {
        void message.warning(`资料集已删除，但存在清理告警：${warningMessage}`);
      }
    }
  }

  function openCreatePanel() {
    const initial = createInitialPanelState();
    setCreateInitialValues(initial);
    createForm.setFieldsValue(initial);
    setCreateErrorText("");
    setCreateSaving(false);
    setCreatePanelOpen(true);
  }

  function handleKnowledgeSetSelect(knowledgeSetId: string) {
    setSelectedKnowledgeSetId(knowledgeSetId);
    if (isNarrowScreen) {
      setMobileDetailOpen(true);
    }
  }

  useEffect(() => {
    if (!isNarrowScreen) {
      setMobileDetailOpen(false);
    }
  }, [isNarrowScreen]);

  async function closeCreatePanel(forceClose = false) {
    const currentValues = createForm.getFieldsValue();
    if (
      !forceClose &&
      !deepEqual(normalizeRecordForCompare(currentValues), normalizeRecordForCompare(createInitialValues))
    ) {
      const confirmed = await openWarningConfirm({
        title: "确认关闭新建资料集",
        content: "当前未保存的资料集信息将丢失。",
        dangerLevel: "warning",
        okButtonDanger: false,
        okText: "放弃并关闭",
        cancelText: "继续编辑"
      });
      if (!confirmed) return;
    }
    setCreatePanelOpen(false);
    setCreateErrorText("");
    setCreateSaving(false);
    createForm.resetFields();
  }

  async function handleCreateSave() {
    let values: CreatePanelState;
    try {
      values = await createForm.validateFields();
    } catch {
      return;
    }

    const trimmedName = values.name.trim();
    if (!trimmedName) {
      setCreateErrorText("请填写资料集名称");
      return;
    }

    setCreateSaving(true);
    setCreateErrorText("");
    try {
      const response = await createKnowledgeSet({
        name: trimmedName,
        description: values.description.trim()
      });
      setKnowledgeSets((current) => [...current, response.knowledgeSet]);
      setSelectedKnowledgeSetId(response.knowledgeSet.id);
      setSearch("");
      setStatusFilter("all");
      await closeCreatePanel(true);
    } catch (error) {
      setCreateErrorText(error instanceof Error ? error.message : "创建资料集失败");
      setCreateSaving(false);
    }
  }

  return (
    <div className="admin-page-container">
      <div className="admin-page-header">
        <div>
          <Typography.Title level={3} style={{ margin: 0, marginBottom: 8 }}>
            资料集
          </Typography.Title>
          <Typography.Text type="secondary">维护资料、文件清单与授权策略。</Typography.Text>
        </div>
        <Space>
          <Tag color="blue" style={{ borderRadius: 'var(--admin-radius-full)' }}>{filterScopeLabel}</Tag>
          <Button icon={<ReloadOutlined />} onClick={() => setReloadNonce((current) => current + 1)} loading={loading}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreatePanel} style={{ borderRadius: 'var(--admin-radius-full)' }}>
            新建资料集
          </Button>
        </Space>
      </div>

      <div className="admin-split-layout" style={{ marginTop: 16 }}>
        <div className="admin-split-master">
          <div style={{ padding: '16px', borderBottom: '1px solid var(--admin-color-border)' }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Input
                prefix={<span style={{ color: 'var(--admin-color-subtle)' }}>🔍</span>}
                placeholder="搜索资料集..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                allowClear
                style={{ borderRadius: 'var(--admin-radius-full)' }}
              />
              <Select
                value={statusFilter}
                options={STATUS_FILTER_OPTIONS}
                onChange={(value) => setStatusFilter(value)}
                size="small"
                style={{ width: '100%' }}
              />
            </Space>
          </div>

          <div className="admin-master-list">
            {loading ? (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <Spin size="small" />
              </div>
            ) : filteredKnowledgeSets.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选条件下没有资料集。" />
            ) : (
              filteredKnowledgeSets.map((knowledgeSet) => {
                const active = selectedKnowledgeSet?.id === knowledgeSet.id;
                return (
                  <div
                    key={knowledgeSet.id}
                    className={`admin-master-item ${active ? 'active' : ''}`}
                    onClick={() => handleKnowledgeSetSelect(knowledgeSet.id)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                      <strong style={{ fontSize: 14, fontWeight: 600 }}>{knowledgeSet.name}</strong>
                      <Tag color={knowledgeSet.status === "active" ? "success" : "default"} style={{ margin: 0, borderRadius: 4 }}>
                        {knowledgeSet.status}
                      </Tag>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--admin-color-subtle)', marginBottom: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {knowledgeSet.slug}
                    </div>
                    <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                      <Tag style={{ margin: 0, border: 'none', background: 'var(--admin-color-bg)' }}>
                        {knowledgeSet.sourceType === "managed_upload" ? "托管上传" : knowledgeSet.sourceType}
                      </Tag>
                      <span style={{ color: 'var(--admin-color-subtle)', fontSize: 11, alignSelf: 'center' }}>
                        {formatLocalDateTime(knowledgeSet.updatedAt)}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="admin-split-detail">
          {!isNarrowScreen ? (
            selectedKnowledgeSet ? (
              <div style={{ height: '100%', overflow: 'auto' }}>
                <KnowledgeSetDetailView
                  knowledgeSet={selectedKnowledgeSet}
                  onKnowledgeSetUpdated={handleKnowledgeSetUpdated}
                  onKnowledgeSetDeleted={handleKnowledgeSetDeleted}
                />
              </div>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择左侧资料集以继续配置" style={{ marginTop: '20%' }} />
            )
          ) : null}
        </div>
      </div>

      {isNarrowScreen ? (
        <Drawer
          title={selectedKnowledgeSet ? `资料集：${selectedKnowledgeSet.name}` : "资料集详情"}
          placement="right"
          width="94%"
          open={mobileDetailOpen && Boolean(selectedKnowledgeSet)}
          onClose={() => setMobileDetailOpen(false)}
          destroyOnClose={false}
        >
          {selectedKnowledgeSet ? (
            <KnowledgeSetDetailView
              knowledgeSet={selectedKnowledgeSet}
              onKnowledgeSetUpdated={handleKnowledgeSetUpdated}
              onKnowledgeSetDeleted={handleKnowledgeSetDeleted}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请先选择资料集。" />
          )}
        </Drawer>
      ) : null}

      <Drawer
        title="新建资料集"
        width={520}
        open={createPanelOpen}
        onClose={() => void closeCreatePanel()}
        destroyOnClose
        maskClosable={!createSaving}
        footer={(
          <Space>
            <Button onClick={() => void closeCreatePanel()} disabled={createSaving}>
              取消
            </Button>
            <Button type="primary" onClick={() => void handleCreateSave()} loading={createSaving}>
              保存新资料集
            </Button>
          </Space>
        )}
      >
        {createErrorText ? <Alert className="admin-alert-inline" type="error" showIcon message={createErrorText} /> : null}

        <Form form={createForm} layout="vertical" requiredMark={false} initialValues={createInitialPanelState()}>
          <Form.Item
            label="资料集名称"
            name="name"
            rules={[{ required: true, whitespace: true, message: "请填写资料集名称" }]}
          >
            <Input aria-label="新建资料集名称" maxLength={128} placeholder="例如：售后知识库" />
          </Form.Item>

          <Form.Item label="资料来源">
            <Input value="托管上传" disabled />
          </Form.Item>

          <Form.Item label="默认状态">
            <Input value="active" disabled />
          </Form.Item>

          <Form.Item label="资料集描述" name="description">
            <Input.TextArea aria-label="新建资料集描述" rows={5} placeholder="可选：描述资料覆盖范围与维护负责人" />
          </Form.Item>

          <Card size="small" className="admin-workspace-help-card">
            <Space direction="vertical" size={4}>
              <Typography.Text strong>创建后建议操作</Typography.Text>
              <Typography.Text type="secondary">1. 上传文件或压缩包并检查解析结果。</Typography.Text>
              <Typography.Text type="secondary">2. 配置访问策略，限制角色/部门可见范围。</Typography.Text>
            </Space>
          </Card>
        </Form>
      </Drawer>
    </div>
  );
}
