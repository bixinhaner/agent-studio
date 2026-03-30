import { useEffect, useMemo, useState } from "react";

import { fetchKnowledgeSets, fetchWorkspaces } from "./api";
import { KnowledgeSetDetailView } from "./KnowledgeSetDetailView";
import { WorkspaceDetailView } from "./WorkspaceDetailView";
import type {
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

function matchesSearch(input: string, values: Array<string | undefined>) {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return true;
  return values.some((value) => (value || "").toLowerCase().includes(normalized));
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
    return workspaces.filter((workspace) => {
      if (statusFilter !== "all" && workspace.status !== statusFilter) return false;
      if (typeFilter !== "all" && workspace.sourceType !== typeFilter) return false;
      return matchesSearch(search, [workspace.name, workspace.slug, workspace.description, workspace.rootPath]);
    });
  }, [search, statusFilter, typeFilter, workspaces]);

  const filteredKnowledgeSets = useMemo(() => {
    return knowledgeSets.filter((knowledgeSet) => {
      if (statusFilter !== "all" && knowledgeSet.status !== statusFilter) return false;
      if (typeFilter !== "all" && knowledgeSet.sourceType !== typeFilter) return false;
      return matchesSearch(search, [knowledgeSet.name, knowledgeSet.slug, knowledgeSet.description, knowledgeSet.rootPath]);
    });
  }, [knowledgeSets, search, statusFilter, typeFilter]);

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selected.workspaceId) ?? null;
  const selectedKnowledgeSet = knowledgeSets.find((knowledgeSet) => knowledgeSet.id === selected.knowledgeSetId) ?? null;

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

  return (
    <section className="admin-card resource-center-shell">
      <div className="admin-section-header">
        <div>
          <h2>资源配置中心</h2>
          <p>统一管理工作区、资料集、绑定关系和后续资源能力入口。</p>
        </div>
        <div className="resource-center-create-row">
          <button type="button" className="admin-action-btn">
            {tab === "workspace" ? "新建工作区" : "新建资料集"}
          </button>
        </div>
      </div>

      <div className="resource-center-type-tabs" role="tablist" aria-label="资源类型">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "workspace"}
          className={tab === "workspace" ? "resource-center-type-tab active" : "resource-center-type-tab"}
          onClick={() => setTab("workspace")}
        >
          工作区
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "knowledge_set"}
          className={tab === "knowledge_set" ? "resource-center-type-tab active" : "resource-center-type-tab"}
          onClick={() => setTab("knowledge_set")}
        >
          资料集
        </button>
      </div>

      <div className="resource-center-toolbar">
        <label className="field resource-center-search">
          <span className="field-label">搜索资源</span>
          <input
            className="field-input"
            aria-label="搜索资源"
            placeholder={tab === "workspace" ? "名称、slug、路径" : "名称、slug、路径或描述"}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
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

      {loading ? <p className="resource-center-subtle">加载资源列表中...</p> : null}
      {errorText ? <p className="err-text">{errorText}</p> : null}

      <div className="resource-center-body">
        <aside className="resource-center-sidebar">
          <ul className="resource-center-list">
            {tab === "workspace"
              ? filteredWorkspaces.map((workspace) => {
                  const active = selectedWorkspace?.id === workspace.id;
                  return (
                    <li key={workspace.id}>
                      <button
                        type="button"
                        className={active ? "resource-center-item active" : "resource-center-item"}
                        onClick={() => setSelected((current) => ({ ...current, workspaceId: workspace.id }))}
                      >
                        <span className="resource-center-item-title">{workspace.name}</span>
                        <span className="resource-center-item-meta">
                          {workspace.sourceType} · {workspace.status}
                        </span>
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
                        onClick={() => setSelected((current) => ({ ...current, knowledgeSetId: knowledgeSet.id }))}
                      >
                        <span className="resource-center-item-title">{knowledgeSet.name}</span>
                        <span className="resource-center-item-meta">
                          {knowledgeSet.sourceType} · {knowledgeSet.status}
                        </span>
                      </button>
                    </li>
                  );
                })}
          </ul>

          {tab === "workspace" && filteredWorkspaces.length === 0 ? (
            <p className="resource-center-empty">当前筛选条件下没有工作区。</p>
          ) : null}
          {tab === "knowledge_set" && filteredKnowledgeSets.length === 0 ? (
            <p className="resource-center-empty">当前筛选条件下没有资料集。</p>
          ) : null}
        </aside>

        <section className="resource-center-detail">
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
          {((tab === "workspace" && !selectedWorkspace) || (tab === "knowledge_set" && !selectedKnowledgeSet)) && (
            <div className="resource-center-placeholder empty">
              <h3>{tab === "workspace" ? "工作区详情" : "资料集详情"}</h3>
              <p>请选择左侧资源以继续配置。</p>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
