import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Input, Spin, Tag, Typography } from "antd";

import { createKnowledgeSet, createWorkspace, fetchKnowledgeSets, fetchWorkspaces } from "./api";
import { KnowledgeSetDetailView } from "./KnowledgeSetDetailView";
import { WorkspaceDetailView } from "./WorkspaceDetailView";
import type {
  CreateKnowledgeSetInput,
  CreateWorkspaceInput,
  KnowledgeSetRecord,
  ResourceCenterTab,
  ResourceStatusFilter,
  ResourceTypeFilter,
  WorkspaceRecord
} from "./types";

type SelectedState = {
  workspaceId: string | null;
  knowledgeSetId: string | null;
};

type CreatePanelState =
  | {
      kind: "workspace";
      name: string;
      slug: string;
      description: string;
      sourceType: "filesystem";
      status: string;
      rootPath: string;
    }
  | {
      kind: "knowledge_set";
      name: string;
      slug: string;
      description: string;
      sourceType: "filesystem" | "managed_upload";
      status: string;
      rootPath: string;
      storageKey: string;
    };

const RESOURCE_TAB_META: Record<ResourceCenterTab, { title: string; description: string }> = {
  workspace: {
    title: "工作区管理",
    description: "维护工作区目录、启停状态和资料集绑定关系。"
  },
  knowledge_set: {
    title: "资料集管理",
    description: "维护资料元数据、上传来源和授权策略。"
  }
};

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

function createInitialPanelState(tab: ResourceCenterTab): CreatePanelState {
  if (tab === "workspace") {
    return {
      kind: "workspace",
      name: "",
      slug: "",
      description: "",
      sourceType: "filesystem",
      status: "active",
      rootPath: ""
    };
  }
  return {
    kind: "knowledge_set",
    name: "",
    slug: "",
    description: "",
    sourceType: "filesystem",
    status: "active",
    rootPath: "",
    storageKey: ""
  };
}

export function ResourceCenterShell() {
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [knowledgeSets, setKnowledgeSets] = useState<KnowledgeSetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [tab, setTab] = useState<ResourceCenterTab>("workspace");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ResourceStatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<ResourceTypeFilter>("all");
  const [selected, setSelected] = useState<SelectedState>({ workspaceId: null, knowledgeSetId: null });
  const [createPanel, setCreatePanel] = useState<CreatePanelState | null>(null);
  const [createSaving, setCreateSaving] = useState(false);
  const [createErrorText, setCreateErrorText] = useState("");
  const currentTabMeta = RESOURCE_TAB_META[tab];

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setErrorText("");
      try {
        const [workspaceResponse, knowledgeSetResponse] = await Promise.all([fetchWorkspaces(), fetchKnowledgeSets()]);
        if (!active) return;
        setWorkspaces(workspaceResponse.workspaces);
        setKnowledgeSets(knowledgeSetResponse.knowledgeSets);
      } catch (error) {
        if (active) {
          setErrorText(error instanceof Error ? error.message : "加载资源配置中心失败");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (tab === "workspace" && typeFilter === "managed_upload") {
      setTypeFilter("all");
    }
  }, [tab, typeFilter]);

  const filteredWorkspaces = useMemo(() => {
    const matched = workspaces.filter((workspace) => {
      if (statusFilter !== "all" && workspace.status !== statusFilter) return false;
      if (typeFilter !== "all" && workspace.sourceType !== typeFilter) return false;
      return matchesSearch(search, [workspace.name, workspace.slug, workspace.description, workspace.rootPath]);
    });
    return matched.sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt);
      const rightTime = Date.parse(right.updatedAt);
      if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
        return left.name.localeCompare(right.name, "zh-CN");
      }
      return rightTime - leftTime;
    });
  }, [search, statusFilter, typeFilter, workspaces]);

  const filteredKnowledgeSets = useMemo(() => {
    const matched = knowledgeSets.filter((knowledgeSet) => {
      if (statusFilter !== "all" && knowledgeSet.status !== statusFilter) return false;
      if (typeFilter !== "all" && knowledgeSet.sourceType !== typeFilter) return false;
      return matchesSearch(search, [knowledgeSet.name, knowledgeSet.slug, knowledgeSet.description, knowledgeSet.rootPath]);
    });
    return matched.sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt);
      const rightTime = Date.parse(right.updatedAt);
      if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
        return left.name.localeCompare(right.name, "zh-CN");
      }
      return rightTime - leftTime;
    });
  }, [knowledgeSets, search, statusFilter, typeFilter]);

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selected.workspaceId) ?? null;
  const selectedKnowledgeSet = knowledgeSets.find((knowledgeSet) => knowledgeSet.id === selected.knowledgeSetId) ?? null;
  const activeListCount = tab === "workspace" ? filteredWorkspaces.length : filteredKnowledgeSets.length;
  const activeEnabledCount =
    tab === "workspace"
      ? filteredWorkspaces.filter((workspace) => workspace.status === "active").length
      : filteredKnowledgeSets.filter((knowledgeSet) => knowledgeSet.status === "active").length;
  const activeDisabledCount = Math.max(activeListCount - activeEnabledCount, 0);
  const selectedResourceSource = (() => {
    if (tab === "workspace") {
      return selectedWorkspace?.rootPath || "未设置";
    }
    return selectedKnowledgeSet?.rootPath || selectedKnowledgeSet?.storageKey || "未设置";
  })();
  const selectedResourceUpdatedAt = tab === "workspace" ? selectedWorkspace?.updatedAt : selectedKnowledgeSet?.updatedAt;
  const selectedResourceSummary = (() => {
    const name = tab === "workspace" ? selectedWorkspace?.name : selectedKnowledgeSet?.name;
    return name ? `已选：${name}` : "未选择";
  })();

  useEffect(() => {
    if (tab !== "workspace") return;
    if (createPanel?.kind === "workspace") return;
    if (filteredWorkspaces.length === 0) return;
    const selectedStillVisible = filteredWorkspaces.some((workspace) => workspace.id === selected.workspaceId);
    if (!selectedStillVisible) {
      setSelected((current) => ({ ...current, workspaceId: filteredWorkspaces[0].id }));
    }
  }, [createPanel?.kind, filteredWorkspaces, selected.workspaceId, tab]);

  useEffect(() => {
    if (tab !== "knowledge_set") return;
    if (createPanel?.kind === "knowledge_set") return;
    if (filteredKnowledgeSets.length === 0) return;
    const selectedStillVisible = filteredKnowledgeSets.some((knowledgeSet) => knowledgeSet.id === selected.knowledgeSetId);
    if (!selectedStillVisible) {
      setSelected((current) => ({ ...current, knowledgeSetId: filteredKnowledgeSets[0].id }));
    }
  }, [createPanel?.kind, filteredKnowledgeSets, selected.knowledgeSetId, tab]);

  function handleWorkspaceUpdated(updatedWorkspace: WorkspaceRecord) {
    setWorkspaces((current) =>
      current.map((workspace) => (workspace.id === updatedWorkspace.id ? updatedWorkspace : workspace))
    );
  }

  function handleKnowledgeSetUpdated(updatedKnowledgeSet: KnowledgeSetRecord) {
    setKnowledgeSets((current) =>
      current.map((knowledgeSet) => (knowledgeSet.id === updatedKnowledgeSet.id ? updatedKnowledgeSet : knowledgeSet))
    );
  }

  function openCreatePanel() {
    setCreatePanel(createInitialPanelState(tab));
    setCreateErrorText("");
  }

  function closeCreatePanel() {
    setCreatePanel(null);
    setCreateErrorText("");
    setCreateSaving(false);
  }

  async function handleCreateSave() {
    if (!createPanel) return;
    setCreateSaving(true);
    setCreateErrorText("");
    try {
      if (createPanel.kind === "workspace") {
        const payload: CreateWorkspaceInput = {
          name: createPanel.name.trim(),
          slug: createPanel.slug.trim(),
          description: createPanel.description.trim(),
          status: createPanel.status,
          sourceType: createPanel.sourceType,
          rootPath: createPanel.rootPath.trim()
        };
        const response = await createWorkspace(payload);
        setWorkspaces((current) => [...current, response.workspace]);
        setSelected({ workspaceId: response.workspace.id, knowledgeSetId: null });
      } else {
        const payload: CreateKnowledgeSetInput = {
          name: createPanel.name.trim(),
          slug: createPanel.slug.trim(),
          description: createPanel.description.trim(),
          status: createPanel.status,
          sourceType: createPanel.sourceType,
          ...(createPanel.sourceType === "filesystem"
            ? { rootPath: createPanel.rootPath.trim() }
            : { storageKey: createPanel.storageKey.trim() })
        };
        const response = await createKnowledgeSet(payload);
        setKnowledgeSets((current) => [...current, response.knowledgeSet]);
        setSelected({ workspaceId: null, knowledgeSetId: response.knowledgeSet.id });
      }
      setSearch("");
      setStatusFilter("all");
      setTypeFilter("all");
      closeCreatePanel();
    } catch (error) {
      setCreateErrorText(error instanceof Error ? error.message : "创建资源失败");
      setCreateSaving(false);
    }
  }

  return (
    <Card className="admin-card resource-center-shell antd-admin-card">
      <div className="admin-section-header">
        <div>
          <Typography.Title level={4} className="admin-card-heading">
            资源配置中心
          </Typography.Title>
          <Typography.Paragraph>统一管理工作区、资料集、绑定关系和后续资源能力入口。</Typography.Paragraph>
        </div>
        <div className="resource-center-create-row">
          <Button type="primary" onClick={openCreatePanel}>
            {tab === "workspace" ? "新建工作区" : "新建资料集"}
          </Button>
        </div>
      </div>

      <section className="resource-center-hero">
        <div>
          <p className="auth-eyebrow">Agent Studio Resources</p>
          <Typography.Title level={5} className="admin-card-subheading">
            {currentTabMeta.title}
          </Typography.Title>
          <Typography.Paragraph>{currentTabMeta.description}</Typography.Paragraph>
        </div>
        <div className="resource-center-hero-meta">
          <Tag color="blue">当前类型：{tab === "workspace" ? "工作区" : "资料集"}</Tag>
          <Tag>{selectedResourceSummary}</Tag>
          <Tag>最近更新：{formatLocalDateTime(selectedResourceUpdatedAt)}</Tag>
        </div>
      </section>

      <div className="resource-center-type-tabs" role="tablist" aria-label="资源类型">
        <Button
          type={tab === "workspace" ? "primary" : "default"}
          role="tab"
          aria-selected={tab === "workspace"}
          aria-label="工作区"
          className={tab === "workspace" ? "resource-center-type-tab active" : "resource-center-type-tab"}
          onClick={() => setTab("workspace")}
        >
          工作区
        </Button>
        <Button
          type={tab === "knowledge_set" ? "primary" : "default"}
          role="tab"
          aria-selected={tab === "knowledge_set"}
          aria-label="资料集"
          className={tab === "knowledge_set" ? "resource-center-type-tab active" : "resource-center-type-tab"}
          onClick={() => setTab("knowledge_set")}
        >
          资料集
        </Button>
      </div>

      <div className="resource-center-toolbar">
        <label className="field resource-center-search">
          <span className="field-label">搜索资源</span>
          <Input
            aria-label="搜索资源"
            placeholder={tab === "workspace" ? "名称、slug、路径" : "名称、slug、路径或描述"}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            allowClear
          />
        </label>

        <label className="field resource-center-filter">
          <span className="field-label">状态筛选</span>
          <select
            className="field-input"
            aria-label="状态筛选"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as ResourceStatusFilter)}
          >
            <option value="all">全部状态</option>
            <option value="active">启用中</option>
            <option value="disabled">已禁用</option>
          </select>
        </label>

        <label className="field resource-center-filter">
          <span className="field-label">类型筛选</span>
          <select
            className="field-input"
            aria-label="类型筛选"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as ResourceTypeFilter)}
          >
            <option value="all">全部类型</option>
            <option value="filesystem">filesystem</option>
            {tab === "knowledge_set" ? <option value="managed_upload">managed_upload</option> : null}
          </select>
        </label>
      </div>

      <div className="resource-center-stats-row" aria-label="资源统计">
        <article className="resource-center-stat-card">
          <span className="resource-center-stat-label">{tab === "workspace" ? "工作区总数" : "资料集总数"}</span>
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
          <span className="resource-center-stat-label">选中资源来源</span>
          <strong className="resource-center-stat-value">{selectedResourceSource}</strong>
        </article>
      </div>

      {loading ? <Spin size="small" /> : null}
      {errorText ? <Alert className="admin-alert-inline" type="error" showIcon message={errorText} /> : null}

      <div className="resource-center-body">
        <aside className="resource-center-sidebar">
          <div className="resource-center-sidebar-header">
            <span>{tab === "workspace" ? "工作区列表" : "资料集列表"}</span>
            <Tag color="blue">{activeListCount}</Tag>
          </div>

          <div className="resource-center-list-wrap">
            <ul className="resource-center-list">
              {tab === "workspace"
                ? filteredWorkspaces.map((workspace) => {
                    const active = selectedWorkspace?.id === workspace.id;
                    return (
                      <li key={workspace.id}>
                        <button
                          type="button"
                          className={active ? "resource-center-item active" : "resource-center-item"}
                          onClick={() => setSelected({ workspaceId: workspace.id, knowledgeSetId: null })}
                        >
                          <span className="resource-center-item-title-row">
                            <span className="resource-center-item-title">{workspace.name}</span>
                            <Tag color={workspace.status === "active" ? "success" : "default"}>{workspace.status}</Tag>
                          </span>
                          <span className="resource-center-item-slug">{workspace.slug}</span>
                          <span className="resource-center-item-meta">
                            <Tag>{workspace.sourceType}</Tag>
                          </span>
                          <span className="resource-center-item-note">{workspace.rootPath || "未设置根目录"}</span>
                        </button>
                      </li>
                    );
                  })
                : filteredKnowledgeSets.map((knowledgeSet) => {
                    const active = selectedKnowledgeSet?.id === knowledgeSet.id;
                    return (
                      <li key={knowledgeSet.id}>
                        <button
                          type="button"
                          className={active ? "resource-center-item active" : "resource-center-item"}
                          onClick={() => setSelected({ workspaceId: null, knowledgeSetId: knowledgeSet.id })}
                        >
                          <span className="resource-center-item-title-row">
                            <span className="resource-center-item-title">{knowledgeSet.name}</span>
                            <Tag color={knowledgeSet.status === "active" ? "success" : "default"}>{knowledgeSet.status}</Tag>
                          </span>
                          <span className="resource-center-item-slug">{knowledgeSet.slug}</span>
                          <span className="resource-center-item-meta">
                            <Tag>{knowledgeSet.sourceType}</Tag>
                          </span>
                          <span className="resource-center-item-note">
                            {knowledgeSet.rootPath || knowledgeSet.storageKey || "未设置来源"}
                          </span>
                        </button>
                      </li>
                    );
                  })}
            </ul>
          </div>

          {tab === "workspace" && filteredWorkspaces.length === 0 ? (
            <p className="resource-center-empty">当前筛选条件下没有工作区。</p>
          ) : null}
          {tab === "knowledge_set" && filteredKnowledgeSets.length === 0 ? (
            <p className="resource-center-empty">当前筛选条件下没有资料集。</p>
          ) : null}
        </aside>

        <section className="resource-center-detail">
          {createPanel ? (
            <section className="resource-center-section resource-center-create-panel">
              <div className="resource-center-section-header">
                <div>
                  <h3>{createPanel.kind === "workspace" ? "新建工作区" : "新建资料集"}</h3>
                  <p>填写最小必需字段后创建资源，创建成功后会自动选中并进入详情页。</p>
                </div>
              </div>

              {createErrorText ? <Alert className="admin-alert-inline" type="error" showIcon message={createErrorText} /> : null}

              <div className="resource-center-form-grid">
                <div className="resource-center-form-span-2 admin-form-inline-section-head">
                  <h4>基础信息</h4>
                  <p>名称用于展示，slug 用于唯一标识。</p>
                </div>
                <label className="field">
                  <span className="field-label">{createPanel.kind === "workspace" ? "新建工作区名称" : "新建资料集名称"}</span>
                  <input
                    className="field-input"
                    aria-label={createPanel.kind === "workspace" ? "新建工作区名称" : "新建资料集名称"}
                    value={createPanel.name}
                    disabled={createSaving}
                    onChange={(event) => setCreatePanel((current) => (current ? { ...current, name: event.target.value } : current))}
                  />
                  <small className="field-help">建议使用业务可识别名称，便于后续搜索定位。</small>
                </label>

                <label className="field">
                  <span className="field-label">{createPanel.kind === "workspace" ? "新建工作区 slug" : "新建资料集 slug"}</span>
                  <input
                    className="field-input"
                    aria-label={createPanel.kind === "workspace" ? "新建工作区 slug" : "新建资料集 slug"}
                    value={createPanel.slug}
                    disabled={createSaving}
                    onChange={(event) => setCreatePanel((current) => (current ? { ...current, slug: event.target.value } : current))}
                  />
                  <small className="field-help">仅允许稳定标识，建议使用小写英文和连字符。</small>
                </label>

                {createPanel.kind === "knowledge_set" ? (
                  <label className="field">
                    <span className="field-label">新建资料集类型</span>
                    <select
                      className="field-input"
                      aria-label="新建资料集类型"
                      value={createPanel.sourceType}
                      disabled={createSaving}
                      onChange={(event) =>
                        setCreatePanel((current) =>
                          current && current.kind === "knowledge_set"
                            ? {
                                ...current,
                                sourceType: event.target.value as "filesystem" | "managed_upload",
                                rootPath: event.target.value === "filesystem" ? current.rootPath : "",
                                storageKey: event.target.value === "managed_upload" ? current.storageKey : ""
                              }
                            : current
                        )
                      }
                    >
                      <option value="filesystem">filesystem</option>
                      <option value="managed_upload">managed_upload</option>
                    </select>
                    <small className="field-help">`filesystem` 直接读取目录；`managed_upload` 使用托管文件。</small>
                  </label>
                ) : null}

                <label className="field">
                  <span className="field-label">{createPanel.kind === "workspace" ? "新建工作区状态" : "新建资料集状态"}</span>
                  <select
                    className="field-input"
                    aria-label={createPanel.kind === "workspace" ? "新建工作区状态" : "新建资料集状态"}
                    value={createPanel.status}
                    disabled={createSaving}
                    onChange={(event) => setCreatePanel((current) => (current ? { ...current, status: event.target.value } : current))}
                  >
                    <option value="active">active</option>
                    <option value="disabled">disabled</option>
                  </select>
                  <small className="field-help">禁用后不会被新会话默认加载。</small>
                </label>

                <div className="resource-center-form-span-2 admin-form-inline-section-head">
                  <h4>来源配置</h4>
                  <p>根据来源类型填写目录或存储键。</p>
                </div>

                {createPanel.kind === "workspace" || createPanel.sourceType === "filesystem" ? (
                  <label className="field resource-center-form-span-2">
                    <span className="field-label">
                      {createPanel.kind === "workspace" ? "新建工作区根目录" : "新建资料集根目录"}
                    </span>
                    <input
                      className="field-input"
                      aria-label={createPanel.kind === "workspace" ? "新建工作区根目录" : "新建资料集根目录"}
                      value={createPanel.rootPath}
                      disabled={createSaving}
                      onChange={(event) => setCreatePanel((current) => (current ? { ...current, rootPath: event.target.value } : current))}
                    />
                    <small className="field-help">填写服务端可访问的绝对路径。</small>
                  </label>
                ) : null}

                {createPanel.kind === "knowledge_set" && createPanel.sourceType === "managed_upload" ? (
                  <label className="field resource-center-form-span-2">
                    <span className="field-label">新建资料集存储键</span>
                    <input
                      className="field-input"
                      aria-label="新建资料集存储键"
                      value={createPanel.storageKey}
                      disabled={createSaving}
                      onChange={(event) =>
                        setCreatePanel((current) =>
                          current && current.kind === "knowledge_set" ? { ...current, storageKey: event.target.value } : current
                        )
                      }
                    />
                    <small className="field-help">用于对象存储分桶或命名空间，保持全局唯一。</small>
                  </label>
                ) : null}

                <label className="field resource-center-form-span-2">
                  <span className="field-label">{createPanel.kind === "workspace" ? "新建工作区描述" : "新建资料集描述"}</span>
                  <textarea
                    className="field-input textarea"
                    aria-label={createPanel.kind === "workspace" ? "新建工作区描述" : "新建资料集描述"}
                    value={createPanel.description}
                    disabled={createSaving}
                    onChange={(event) => setCreatePanel((current) => (current ? { ...current, description: event.target.value } : current))}
                  />
                  <small className="field-help">可写业务用途、维护人和使用边界。</small>
                </label>
              </div>

              <div className="resource-center-actions">
                <Button
                  type="primary"
                  aria-label={createPanel.kind === "workspace" ? "保存新工作区" : "保存新资料集"}
                  disabled={createSaving}
                  onClick={() => void handleCreateSave()}
                >
                  {createSaving ? "创建中..." : createPanel.kind === "workspace" ? "保存新工作区" : "保存新资料集"}
                </Button>
                <Button aria-label="取消创建" disabled={createSaving} onClick={closeCreatePanel}>
                  取消创建
                </Button>
              </div>
            </section>
          ) : null}

          {tab === "workspace" && selectedWorkspace ? (
            <WorkspaceDetailView
              workspace={selectedWorkspace}
              knowledgeSets={knowledgeSets}
              onWorkspaceUpdated={handleWorkspaceUpdated}
            />
          ) : null}
          {tab === "knowledge_set" && selectedKnowledgeSet ? (
            <KnowledgeSetDetailView
              knowledgeSet={selectedKnowledgeSet}
              onKnowledgeSetUpdated={handleKnowledgeSetUpdated}
            />
          ) : null}
          {!createPanel && ((tab === "workspace" && !selectedWorkspace) || (tab === "knowledge_set" && !selectedKnowledgeSet)) ? (
            <div className="resource-center-placeholder empty">
              <h3>{tab === "workspace" ? "工作区详情" : "资料集详情"}</h3>
              <p>请选择左侧资源以继续配置。</p>
            </div>
          ) : null}
        </section>
      </div>
    </Card>
  );
}
