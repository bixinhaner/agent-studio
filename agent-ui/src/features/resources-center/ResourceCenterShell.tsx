import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
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

  function handleKnowledgeSetUpdated(updatedKnowledgeSet: KnowledgeSetRecord) {
    setKnowledgeSets((current) =>
      current.map((knowledgeSet) => (knowledgeSet.id === updatedKnowledgeSet.id ? updatedKnowledgeSet : knowledgeSet))
    );
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
    <Card className="admin-card resource-center-shell antd-admin-card admin-workspace-shell">
      <div className="admin-section-header admin-workspace-header">
        <div>
          <Typography.Title level={4} className="admin-card-heading">
            资料配置中心
          </Typography.Title>
          <Typography.Paragraph>统一管理资料集、文件清单与资源授权策略。</Typography.Paragraph>
        </div>
        <Space wrap>
          <Tag color="blue">总计 {knowledgeSets.length}</Tag>
          <Button icon={<ReloadOutlined />} onClick={() => setReloadNonce((current) => current + 1)} loading={loading}>
            刷新列表
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreatePanel}>
            新建资料集
          </Button>
        </Space>
      </div>

      <section className="resource-center-hero admin-workspace-hero">
        <div>
          <p className="auth-eyebrow">Agent Studio Knowledge Sets</p>
          <Typography.Title level={5} className="admin-card-subheading">
            资料集工作区
          </Typography.Title>
          <Typography.Paragraph>维护资料元数据、来源配置、文件列表和访问授权。</Typography.Paragraph>
        </div>
        <div className="resource-center-hero-meta">
          <Tag color="blue">当前类型：资料集</Tag>
          <Tag>{selectedKnowledgeSet ? `已选：${selectedKnowledgeSet.name}` : "未选择"}</Tag>
          <Tag>最近更新：{formatLocalDateTime(selectedKnowledgeSet?.updatedAt)}</Tag>
        </div>
      </section>

      {isNarrowScreen ? (
        <div className="resource-center-mobile-toolbar">
          <MobileFilterDrawer title="筛选资料集" filterCount={mobileFilterCount}>
            <Space direction="vertical" size={12} className="admin-full-width">
              <label className="field">
                <span className="field-label">搜索资料集</span>
                <Input
                  aria-label="搜索资料集"
                  placeholder="名称、slug、描述"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  allowClear
                />
              </label>

              <label className="field">
                <span className="field-label">状态筛选</span>
                <Select
                  aria-label="状态筛选"
                  value={statusFilter}
                  options={STATUS_FILTER_OPTIONS}
                  onChange={(value) => setStatusFilter(value)}
                />
              </label>
            </Space>
          </MobileFilterDrawer>
        </div>
      ) : (
        <div className="resource-center-toolbar admin-workspace-toolbar">
          <label className="field resource-center-search">
            <span className="field-label">搜索资料集</span>
            <Input
              aria-label="搜索资料集"
              placeholder="名称、slug、描述"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              allowClear
            />
          </label>

          <label className="field resource-center-filter admin-workspace-filter">
            <span className="field-label">状态筛选</span>
            <Select
              aria-label="状态筛选"
              value={statusFilter}
              options={STATUS_FILTER_OPTIONS}
              onChange={(value) => setStatusFilter(value)}
            />
          </label>
        </div>
      )}

      <div className="resource-center-stats-row" aria-label="资源统计">
        <article className="resource-center-stat-card">
          <span className="resource-center-stat-label">资料集总数</span>
          <strong className="resource-center-stat-value">{activeListCount}</strong>
        </article>
        <article className="resource-center-stat-card">
          <span className="resource-center-stat-label">启用中</span>
          <strong className="resource-center-stat-value">{activeEnabledCount}</strong>
        </article>
        <article className="resource-center-stat-card">
          <span className="resource-center-stat-label">停用中</span>
          <strong className="resource-center-stat-value">{activeDisabledCount}</strong>
        </article>
        <article className="resource-center-stat-card">
          <span className="resource-center-stat-label">新建默认状态</span>
          <strong className="resource-center-stat-value">active</strong>
        </article>
      </div>

      {loading ? (
        <div className="admin-workspace-loading">
          <Spin size="small" />
        </div>
      ) : null}
      {errorText ? <Alert className="admin-alert-inline" type="error" showIcon message={errorText} /> : null}

      <div className="resource-center-body admin-workspace-body">
        <aside className="resource-center-sidebar">
          <div className="resource-center-sidebar-header">
            <span>资料集列表</span>
            <Tag color="blue">{activeListCount}</Tag>
          </div>

          <div className="resource-center-list-wrap">
            <ul className="resource-center-list">
              {filteredKnowledgeSets.map((knowledgeSet) => {
                const active = selectedKnowledgeSet?.id === knowledgeSet.id;
                return (
                  <li key={knowledgeSet.id}>
                    <button
                      type="button"
                      className={active ? "resource-center-item active" : "resource-center-item"}
                      onClick={() => handleKnowledgeSetSelect(knowledgeSet.id)}
                    >
                      <span className="resource-center-item-title-row">
                        <span className="resource-center-item-title">{knowledgeSet.name}</span>
                        <Tag color={knowledgeSet.status === "active" ? "success" : "default"}>{knowledgeSet.status}</Tag>
                      </span>
                      <span className="resource-center-item-meta">
                        <Tag>{knowledgeSet.sourceType === "managed_upload" ? "托管上传" : knowledgeSet.sourceType}</Tag>
                        <span className="resource-center-inline-muted">更新于 {formatLocalDateTime(knowledgeSet.updatedAt)}</span>
                      </span>
                      <span className="resource-center-item-note">{knowledgeSetCardSummary(knowledgeSet)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {filteredKnowledgeSets.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              className="resource-center-empty-block"
              description="当前筛选条件下没有资料集。"
            />
          ) : null}
        </aside>

        {!isNarrowScreen ? (
          <section className="resource-center-detail admin-workspace-detail">
            {selectedKnowledgeSet ? (
              <KnowledgeSetDetailView knowledgeSet={selectedKnowledgeSet} onKnowledgeSetUpdated={handleKnowledgeSetUpdated} />
            ) : (
              <div className="resource-center-placeholder empty">
                <h3>资料集详情</h3>
                <p>请选择左侧资料集以继续配置。</p>
              </div>
            )}
          </section>
        ) : null}
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
            <KnowledgeSetDetailView knowledgeSet={selectedKnowledgeSet} onKnowledgeSetUpdated={handleKnowledgeSetUpdated} />
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
    </Card>
  );
}
