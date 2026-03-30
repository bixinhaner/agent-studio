import { useEffect, useMemo, useState } from "react";

import {
  fetchWorkspaceKnowledgeSetBindings,
  putWorkspaceKnowledgeSetBindings,
  updateWorkspace
} from "./api";
import { ResourcePolicyEditor } from "./ResourcePolicyEditor";
import type {
  KnowledgeSetRecord,
  WorkspaceKnowledgeSetBinding,
  WorkspaceRecord
} from "./types";

type WorkspaceDetailViewProps = {
  workspace: WorkspaceRecord;
  knowledgeSets: KnowledgeSetRecord[];
  onWorkspaceUpdated: (workspace: WorkspaceRecord) => void;
};

type BindingState = {
  enabled: boolean;
  mountType: string;
};

function buildBindingState(knowledgeSets: KnowledgeSetRecord[], bindings: WorkspaceKnowledgeSetBinding[]) {
  const bindingMap = new Map(bindings.map((binding) => [binding.knowledgeSetId, binding]));
  return knowledgeSets.reduce<Record<string, BindingState>>((acc, knowledgeSet) => {
    const binding = bindingMap.get(knowledgeSet.id);
    acc[knowledgeSet.id] = {
      enabled: Boolean(binding),
      mountType: binding?.mountType || "default"
    };
    return acc;
  }, {});
}

export function WorkspaceDetailView({ workspace, knowledgeSets, onWorkspaceUpdated }: WorkspaceDetailViewProps) {
  const [name, setName] = useState(workspace.name);
  const [slug, setSlug] = useState(workspace.slug);
  const [description, setDescription] = useState(workspace.description || "");
  const [status, setStatus] = useState(workspace.status);
  const [rootPath, setRootPath] = useState(workspace.rootPath || "");
  const [bindingState, setBindingState] = useState<Record<string, BindingState>>(() =>
    buildBindingState(knowledgeSets, [])
  );
  const [loadingBindings, setLoadingBindings] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");

  useEffect(() => {
    setName(workspace.name);
    setSlug(workspace.slug);
    setDescription(workspace.description || "");
    setStatus(workspace.status);
    setRootPath(workspace.rootPath || "");
    setSuccessText("");
    setErrorText("");
  }, [workspace]);

  useEffect(() => {
    let active = true;

    async function loadBindings() {
      setLoadingBindings(true);
      setErrorText("");
      try {
        const response = await fetchWorkspaceKnowledgeSetBindings(workspace.id);
        if (!active) return;
        setBindingState(buildBindingState(knowledgeSets, response.bindings));
      } catch (error) {
        if (active) {
          setErrorText(error instanceof Error ? error.message : "加载资料集绑定失败");
        }
      } finally {
        if (active) setLoadingBindings(false);
      }
    }

    void loadBindings();
    return () => {
      active = false;
    };
  }, [knowledgeSets, workspace.id]);

  const sortedKnowledgeSets = useMemo(() => {
    return [...knowledgeSets].sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  }, [knowledgeSets]);

  function updateBinding(knowledgeSetId: string, patch: Partial<BindingState>) {
    setBindingState((current) => ({
      ...current,
      [knowledgeSetId]: {
        enabled: current[knowledgeSetId]?.enabled || false,
        mountType: current[knowledgeSetId]?.mountType || "default",
        ...patch
      }
    }));
    setSuccessText("");
  }

  async function handleSave() {
    setSaving(true);
    setErrorText("");
    setSuccessText("");

    try {
      const workspaceResponse = await updateWorkspace(workspace.id, {
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim(),
        status,
        ...(workspace.sourceType === "filesystem" ? { rootPath: rootPath.trim() } : {})
      });

      const bindings = sortedKnowledgeSets.flatMap((knowledgeSet) => {
        const binding = bindingState[knowledgeSet.id];
        if (!binding?.enabled) return [];
        return [{ knowledgeSetId: knowledgeSet.id, mountType: binding.mountType }];
      });

      await putWorkspaceKnowledgeSetBindings(workspace.id, bindings);
      onWorkspaceUpdated(workspaceResponse.workspace);
      setSuccessText("工作区配置已保存");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存工作区配置失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="resource-center-detail-stack">
      <section className="resource-center-section">
        <div className="resource-center-section-header">
          <div>
            <h3>{workspace.name}</h3>
            <p>维护工作区元数据、目录配置和默认/可选资料集绑定。</p>
          </div>
          <span className={status === "active" ? "resource-center-badge" : "resource-center-badge muted"}>{status}</span>
        </div>

        {errorText ? <p className="err-text">{errorText}</p> : null}
        {successText ? <p className="resource-center-success">{successText}</p> : null}

        <div className="resource-center-form-grid">
          <label className="field">
            <span className="field-label">工作区名称</span>
            <input className="field-input" aria-label="工作区名称" value={name} onChange={(event) => setName(event.target.value)} />
          </label>

          <label className="field">
            <span className="field-label">工作区 slug</span>
            <input className="field-input" aria-label="工作区 slug" value={slug} onChange={(event) => setSlug(event.target.value)} />
          </label>

          <label className="field">
            <span className="field-label">工作区状态</span>
            <select className="field-input" aria-label="工作区状态" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="active">active</option>
              <option value="disabled">disabled</option>
            </select>
          </label>

          {workspace.sourceType === "filesystem" ? (
            <label className="field resource-center-form-span-2">
              <span className="field-label">根目录</span>
              <input className="field-input" aria-label="根目录" value={rootPath} onChange={(event) => setRootPath(event.target.value)} />
            </label>
          ) : null}

          <label className="field resource-center-form-span-2">
            <span className="field-label">工作区描述</span>
            <textarea
              className="field-input textarea"
              aria-label="工作区描述"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        </div>

        <div className="resource-center-actions">
          <button type="button" className="admin-action-btn" onClick={() => void handleSave()} disabled={saving || loadingBindings}>
            {saving ? "保存中..." : "保存工作区配置"}
          </button>
        </div>
      </section>

      <section className="resource-center-section">
        <div className="resource-center-section-header">
          <div>
            <h3>资料集绑定</h3>
            <p>默认挂载会自动带入会话，可选挂载允许用户按授权范围追加勾选。</p>
          </div>
        </div>

        {loadingBindings ? <p className="resource-center-subtle">加载绑定关系中...</p> : null}

        <div className="resource-center-binding-list">
          {sortedKnowledgeSets.map((knowledgeSet) => {
            const binding = bindingState[knowledgeSet.id] || { enabled: false, mountType: "default" };
            return (
              <div key={knowledgeSet.id} className="resource-center-binding-card">
                <label className="field-checkbox resource-center-binding-toggle">
                  <input
                    type="checkbox"
                    aria-label={`绑定资料集 ${knowledgeSet.name}`}
                    checked={binding.enabled}
                    onChange={(event) => updateBinding(knowledgeSet.id, { enabled: event.target.checked })}
                  />
                  <span>
                    <strong>{knowledgeSet.name}</strong>
                    <small>{knowledgeSet.slug}</small>
                  </span>
                </label>

                {binding.enabled ? (
                  <label className="field resource-center-binding-mode">
                    <span className="field-label">挂载方式 {knowledgeSet.name}</span>
                    <select
                      className="field-input"
                      aria-label={`挂载方式 ${knowledgeSet.name}`}
                      value={binding.mountType}
                      onChange={(event) => updateBinding(knowledgeSet.id, { mountType: event.target.value })}
                    >
                      <option value="default">default</option>
                      <option value="optional">optional</option>
                    </select>
                  </label>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <ResourcePolicyEditor resourceType="workspace" resourceId={workspace.id} title="资源策略编辑器" />
    </div>
  );
}
