import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Drawer, Empty, Input, Segmented, Select, Space, Spin, Tag, Typography } from "antd";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";

import { MobileFilterDrawer } from "../admin/components/MobileFilterDrawer";
import { deepEqual, normalizeRecordForCompare } from "../../lib/object-utils";
import { useIsNarrowScreen } from "../../lib/use-is-narrow-screen";
import { openWarningConfirm } from "../../lib/warning-modal";
import { createIntegrationInstance, fetchIntegrationDetail, fetchIntegrationInstances } from "./api";
import type { CreateIntegrationInstanceInput, IntegrationCenterTab, IntegrationDetail, IntegrationListItem } from "./types";

const DingTalkIntegrationViewLazy = lazy(() =>
  import("./DingTalkIntegrationView").then((module) => ({ default: module.DingTalkIntegrationView }))
);
const ZendeskIntegrationViewLazy = lazy(() =>
  import("./ZendeskIntegrationView").then((module) => ({ default: module.ZendeskIntegrationView }))
);
const OpenAICodexIntegrationViewLazy = lazy(() =>
  import("./OpenAICodexIntegrationView").then((module) => ({ default: module.OpenAICodexIntegrationView }))
);
const OpenAICompatibleApiIntegrationViewLazy = lazy(() =>
  import("./OpenAICompatibleApiIntegrationView").then((module) => ({ default: module.OpenAICompatibleApiIntegrationView }))
);

const TABS: Array<{ id: IntegrationCenterTab; label: string }> = [
  { id: "dingtalk", label: "DingTalk" },
  { id: "zendesk", label: "Zendesk" },
  { id: "openai_codex", label: "OpenAI Codex" },
  { id: "openai_compatible_api", label: "外部 OpenAI API" }
];

function getTabLabel(tab: IntegrationCenterTab): string {
  return TABS.find((item) => item.id === tab)?.label ?? tab;
}

const STATUS_OPTIONS = [
  { label: "active", value: "active" },
  { label: "draft", value: "draft" },
  { label: "disabled", value: "disabled" }
];

type CreateDraft = {
  name: string;
  slug: string;
  description: string;
  status: string;
};

function matchesSearch(search: string, values: Array<string | undefined>) {
  const normalized = search.trim().toLowerCase();
  if (!normalized) return true;
  return values.some((value) => (value || "").toLowerCase().includes(normalized));
}

function buildCreateDraft(tab: IntegrationCenterTab): CreateDraft {
  return {
    name:
      tab === "dingtalk"
        ? "DingTalk"
        : tab === "zendesk"
          ? "Zendesk"
          : tab === "openai_codex"
            ? "OpenAI/Codex"
            : "外部 OpenAI API",
    slug:
      tab === "openai_codex"
        ? "openai-main"
        : tab === "openai_compatible_api"
          ? "external-openai-api"
          : `${tab}-main`,
    description: "",
    status: "active"
  };
}

function formatLocalDateTime(value: string | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
}

function statusTagColor(status: string): string {
  if (status === "active") return "success";
  if (status === "draft") return "warning";
  if (status === "error") return "error";
  return "default";
}

export function IntegrationCenterShell() {
  const [tab, setTab] = useState<IntegrationCenterTab>("dingtalk");
  const [items, setItems] = useState<IntegrationListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<IntegrationDetail | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [createErrorText, setCreateErrorText] = useState("");
  const [createSaving, setCreateSaving] = useState(false);
  const [createPanelOpen, setCreatePanelOpen] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [createDraft, setCreateDraft] = useState<CreateDraft>(() => buildCreateDraft("dingtalk"));
  const [createDraftInitial, setCreateDraftInitial] = useState<CreateDraft>(() => buildCreateDraft("dingtalk"));
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const isNarrowScreen = useIsNarrowScreen(980);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setErrorText("");
      try {
        const response = await fetchIntegrationInstances(tab);
        if (!active) return;
        setItems(response.items);
        setSelectedId((current) => {
          if (current && response.items.some((item) => item.id === current)) {
            return current;
          }
          return response.items[0]?.id ?? null;
        });
      } catch (error) {
        if (!active) return;
        setItems([]);
        setSelectedId(null);
        setErrorText(error instanceof Error ? error.message : "加载集成列表失败");
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    setCreateDraft(buildCreateDraft(tab));
    setCreateDraftInitial(buildCreateDraft(tab));
    setCreatePanelOpen(false);
    setCreateErrorText("");
    return () => {
      active = false;
    };
  }, [reloadNonce, tab]);

  useEffect(() => {
    let active = true;
    async function loadDetail() {
      if (!selectedId) {
        setDetail(null);
        return;
      }
      setDetailLoading(true);
      setErrorText("");
      try {
        const next = await fetchIntegrationDetail(selectedId);
        if (active) setDetail(next);
      } catch (error) {
        if (active) {
          setDetail(null);
          setErrorText(error instanceof Error ? error.message : "加载集成详情失败");
        }
      } finally {
        if (active) setDetailLoading(false);
      }
    }

    void loadDetail();
    return () => {
      active = false;
    };
  }, [selectedId]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => matchesSearch(search, [item.name, item.slug, item.description]));
  }, [items, search]);
  const mobileFilterCount = search.trim() ? 1 : 0;

  const activeCount = filteredItems.filter((item) => item.status === "active").length;
  const currentTabLabel = getTabLabel(tab);

  function handleUpdated(next: IntegrationDetail) {
    setDetail(next);
    setItems((current) => current.map((item) => (item.id === next.instance.id ? next.instance : item)));
  }

  function openCreatePanel() {
    setCreateErrorText("");
    setCreateSaving(false);
    const initial = buildCreateDraft(tab);
    setCreateDraft(initial);
    setCreateDraftInitial(initial);
    setCreatePanelOpen(true);
  }

  async function closeCreatePanel(forceClose = false) {
    if (createSaving) return;
    if (
      !forceClose &&
      !deepEqual(normalizeRecordForCompare(createDraft), normalizeRecordForCompare(createDraftInitial))
    ) {
      const confirmed = await openWarningConfirm({
        title: "确认关闭新建实例",
        content: "当前未保存的新建实例信息将丢失。",
        dangerLevel: "warning",
        okButtonDanger: false,
        okText: "放弃并关闭",
        cancelText: "继续编辑"
      });
      if (!confirmed) return;
    }
    setCreatePanelOpen(false);
    setCreateErrorText("");
  }

  useEffect(() => {
    if (!isNarrowScreen) {
      setMobileDetailOpen(false);
    }
  }, [isNarrowScreen]);

  async function handleCreate() {
    const payload: CreateIntegrationInstanceInput = {
      type: tab,
      name: createDraft.name.trim(),
      slug: createDraft.slug.trim(),
      description: createDraft.description.trim() || null,
      status: createDraft.status
    };

    if (!payload.name) {
      setCreateErrorText("请填写实例名称");
      return;
    }
    if (!payload.slug) {
      setCreateErrorText("请填写实例 slug");
      return;
    }

    setCreateSaving(true);
    setCreateErrorText("");
    try {
      const next = await createIntegrationInstance(payload);
      setItems((current) => [...current, next.instance]);
      setSelectedId(next.instance.id);
      setDetail(next);
      await closeCreatePanel(true);
      setSearch("");
    } catch (error) {
      setCreateErrorText(error instanceof Error ? error.message : "创建集成实例失败");
    } finally {
      setCreateSaving(false);
    }
  }

  return (
    <Card className="admin-card resource-center-shell integration-center-shell antd-admin-card admin-workspace-shell">
      <div className="admin-section-header admin-workspace-header">
        <div>
          <Typography.Title level={4} className="admin-card-heading">
            集成中心
          </Typography.Title>
          <Typography.Paragraph>统一管理 DingTalk、Zendesk、OpenAI/Codex、外部 OpenAI API 实例和授权策略。</Typography.Paragraph>
        </div>
        <Space wrap>
          <Tag color="blue">实例总数 {items.length}</Tag>
          <Tag color={activeCount > 0 ? "success" : "default"}>active {activeCount}</Tag>
          <Button icon={<ReloadOutlined />} onClick={() => setReloadNonce((current) => current + 1)} loading={loading}>
            刷新列表
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreatePanel}>
            新建{currentTabLabel}实例
          </Button>
        </Space>
      </div>

      <div className="resource-center-type-tabs admin-workspace-segmented" role="tablist" aria-label="集成类型">
        <Segmented
          block
          value={tab}
          options={TABS.map((item) => ({ label: item.label, value: item.id }))}
          onChange={(value) => setTab(value as IntegrationCenterTab)}
        />
      </div>

      {isNarrowScreen ? (
        <div className="resource-center-mobile-toolbar">
          <MobileFilterDrawer title="筛选实例" filterCount={mobileFilterCount}>
            <label className="field">
              <span className="field-label">搜索实例</span>
              <Input
                aria-label="搜索实例"
                placeholder="名称、slug、描述"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                allowClear
              />
            </label>
          </MobileFilterDrawer>
        </div>
      ) : (
        <div className="resource-center-toolbar admin-workspace-toolbar">
          <label className="field resource-center-search">
            <span className="field-label">搜索实例</span>
            <Input
              aria-label="搜索实例"
              placeholder="名称、slug、描述"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              allowClear
            />
          </label>
        </div>
      )}

      {errorText ? <Alert className="admin-alert-inline" type="error" showIcon message={errorText} /> : null}

      <div className="resource-center-content admin-workspace-body">
        <aside className="resource-center-sidebar">
          {loading ? (
            <div className="admin-workspace-loading">
              <Spin size="small" />
            </div>
          ) : null}

          {!loading && filteredItems.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} className="resource-center-empty-block" description="当前类型还没有实例。" />
          ) : null}

          <div className="resource-center-list">
            {filteredItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={selectedId === item.id ? "resource-center-list-item active" : "resource-center-list-item"}
              onClick={() => {
                setSelectedId(item.id);
                if (isNarrowScreen) setMobileDetailOpen(true);
              }}
            >
                <strong>{item.name}</strong>
                <span>{item.slug}</span>
                <span className="resource-center-list-item-meta">
                  <Tag color={statusTagColor(item.status)}>{item.status}</Tag>
                  <span className="resource-center-inline-muted">{formatLocalDateTime(item.updatedAt)}</span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        {!isNarrowScreen ? (
          <div className="resource-center-detail admin-workspace-detail">
            {detailLoading ? (
              <div className="admin-workspace-loading">
                <Spin size="small" />
              </div>
            ) : null}

            {!detailLoading && !detail ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} className="resource-center-empty-block" description="请选择一个集成实例。" />
            ) : null}

          {detail && detail.instance.type === "dingtalk" ? (
            <Suspense
              fallback={(
                <div className="admin-workspace-loading">
                  <Spin size="small" />
                </div>
              )}
            >
              <DingTalkIntegrationViewLazy
                instanceId={detail.instance.id}
                onInstanceUpdated={(instance) => {
                  setDetail((current) => (current && current.instance.id === instance.id ? { ...current, instance } : current));
                  setItems((current) => current.map((item) => (item.id === instance.id ? instance : item)));
                }}
              />
            </Suspense>
          ) : null}

            {detail && detail.instance.type === "zendesk" ? (
              <Suspense
                fallback={(
                  <div className="admin-workspace-loading">
                    <Spin size="small" />
                  </div>
                )}
              >
                <ZendeskIntegrationViewLazy detail={detail} onUpdated={handleUpdated} />
              </Suspense>
            ) : null}
            {detail && detail.instance.type === "openai_codex" ? (
              <Suspense
                fallback={(
                  <div className="admin-workspace-loading">
                    <Spin size="small" />
                  </div>
                )}
              >
                <OpenAICodexIntegrationViewLazy detail={detail} onUpdated={handleUpdated} />
              </Suspense>
            ) : null}
            {detail && detail.instance.type === "openai_compatible_api" ? (
              <Suspense
                fallback={(
                  <div className="admin-workspace-loading">
                    <Spin size="small" />
                  </div>
                )}
              >
                <OpenAICompatibleApiIntegrationViewLazy detail={detail} onUpdated={handleUpdated} />
              </Suspense>
            ) : null}
          </div>
        ) : null}
      </div>

      {isNarrowScreen ? (
        <Drawer
          title={detail ? `实例：${detail.instance.name}` : "集成详情"}
          placement="right"
          width="94%"
          open={mobileDetailOpen && Boolean(detail)}
          onClose={() => setMobileDetailOpen(false)}
          destroyOnClose={false}
        >
          {detailLoading ? (
            <div className="admin-workspace-loading">
              <Spin size="small" />
            </div>
          ) : null}

          {!detailLoading && !detail ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} className="resource-center-empty-block" description="请选择一个集成实例。" />
          ) : null}

          {detail && detail.instance.type === "dingtalk" ? (
            <Suspense
              fallback={(
                <div className="admin-workspace-loading">
                  <Spin size="small" />
                </div>
              )}
            >
              <DingTalkIntegrationViewLazy
                instanceId={detail.instance.id}
                onInstanceUpdated={(instance) => {
                  setDetail((current) => (current && current.instance.id === instance.id ? { ...current, instance } : current));
                  setItems((current) => current.map((item) => (item.id === instance.id ? instance : item)));
                }}
              />
            </Suspense>
          ) : null}

          {detail && detail.instance.type === "zendesk" ? (
            <Suspense
              fallback={(
                <div className="admin-workspace-loading">
                  <Spin size="small" />
                </div>
              )}
            >
              <ZendeskIntegrationViewLazy detail={detail} onUpdated={handleUpdated} />
            </Suspense>
          ) : null}
          {detail && detail.instance.type === "openai_codex" ? (
            <Suspense
              fallback={(
                <div className="admin-workspace-loading">
                  <Spin size="small" />
                </div>
              )}
              >
                <OpenAICodexIntegrationViewLazy detail={detail} onUpdated={handleUpdated} />
              </Suspense>
            ) : null}
          {detail && detail.instance.type === "openai_compatible_api" ? (
            <Suspense
              fallback={(
                <div className="admin-workspace-loading">
                  <Spin size="small" />
                </div>
              )}
            >
              <OpenAICompatibleApiIntegrationViewLazy detail={detail} onUpdated={handleUpdated} />
            </Suspense>
          ) : null}
        </Drawer>
      ) : null}

      <Drawer
        title={`新建${currentTabLabel}实例`}
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
            <Button type="primary" onClick={() => void handleCreate()} loading={createSaving}>
              创建实例
            </Button>
          </Space>
        )}
      >
        {createErrorText ? <Alert className="admin-alert-inline" type="error" showIcon message={createErrorText} /> : null}

        <Space direction="vertical" size={14} className="admin-full-width">
          <label className="field">
            <span className="field-label">实例类型</span>
            <Input value={currentTabLabel} disabled />
          </label>

          <label className="field">
            <span className="field-label">实例名称</span>
            <Input
              value={createDraft.name}
              maxLength={128}
              disabled={createSaving}
              onChange={(event) => setCreateDraft((current) => ({ ...current, name: event.target.value }))}
            />
          </label>

          <label className="field">
            <span className="field-label">实例 slug</span>
            <Input
              value={createDraft.slug}
              maxLength={128}
              disabled={createSaving}
              onChange={(event) => setCreateDraft((current) => ({ ...current, slug: event.target.value }))}
            />
          </label>

          <label className="field">
            <span className="field-label">实例描述</span>
            <Input.TextArea
              rows={5}
              value={createDraft.description}
              disabled={createSaving}
              onChange={(event) => setCreateDraft((current) => ({ ...current, description: event.target.value }))}
            />
          </label>

          <label className="field">
            <span className="field-label">初始状态</span>
            <Select
              value={createDraft.status}
              options={STATUS_OPTIONS}
              disabled={createSaving}
              onChange={(value) => setCreateDraft((current) => ({ ...current, status: value }))}
            />
          </label>
        </Space>
      </Drawer>
    </Card>
  );
}
