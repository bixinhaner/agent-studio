import { useEffect, useMemo, useState } from "react";

import {
  createIntegrationInstance,
  fetchIntegrationDetail,
  fetchIntegrationInstances
} from "./api";
import { DingTalkIntegrationView } from "./DingTalkIntegrationView";
import { OpenAICodexIntegrationView } from "./OpenAICodexIntegrationView";
import { ZendeskIntegrationView } from "./ZendeskIntegrationView";
import type { CreateIntegrationInstanceInput, IntegrationCenterTab, IntegrationDetail, IntegrationListItem } from "./types";

const TABS: Array<{ id: IntegrationCenterTab; label: string }> = [
  { id: "dingtalk", label: "DingTalk" },
  { id: "zendesk", label: "Zendesk" },
  { id: "openai_codex", label: "OpenAI-Codex" }
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
    name: tab === "dingtalk" ? "DingTalk" : tab === "zendesk" ? "Zendesk" : "OpenAI/Codex",
    slug: tab === "openai_codex" ? "openai-main" : `${tab}-main`,
    description: "",
    status: "active"
  };
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
  const [showCreate, setShowCreate] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateDraft>(() => buildCreateDraft("dingtalk"));

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setErrorText("");
      try {
        const response = await fetchIntegrationInstances(tab);
        if (!active) return;
        setItems(response.items);
        const nextSelectedId = response.items[0]?.id ?? null;
        setSelectedId(nextSelectedId);
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
    setShowCreate(false);
    setCreateErrorText("");
    return () => {
      active = false;
    };
  }, [tab]);

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

  function handleUpdated(next: IntegrationDetail) {
    setDetail(next);
    setItems((current) => current.map((item) => (item.id === next.instance.id ? next.instance : item)));
  }

  async function handleCreate() {
    const payload: CreateIntegrationInstanceInput = {
      type: tab,
      name: createDraft.name.trim(),
      slug: createDraft.slug.trim(),
      description: createDraft.description.trim() || null,
      status: createDraft.status
    };
    try {
      const next = await createIntegrationInstance(payload);
      setItems((current) => [...current, next.instance]);
      setSelectedId(next.instance.id);
      setDetail(next);
      setShowCreate(false);
      setCreateErrorText("");
    } catch (error) {
      setCreateErrorText(error instanceof Error ? error.message : "创建集成实例失败");
    }
  }

  return (
    <section className="admin-card resource-center-shell integration-center-shell">
      <div className="admin-section-header">
        <div>
          <h2>集成中心</h2>
          <p>统一管理 DingTalk、Zendesk 和 OpenAI/Codex 实例、验证记录和授权范围。</p>
        </div>
        <button type="button" className="admin-action-btn" onClick={() => setShowCreate((current) => !current)}>
          {showCreate ? "取消新建" : "新建实例"}
        </button>
      </div>

      <div className="resource-center-type-tabs" role="tablist" aria-label="集成类型">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? "resource-center-type-tab active" : "resource-center-type-tab"}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {showCreate ? (
        <section className="resource-center-create-panel integration-center-create-panel">
          <div className="resource-center-section-header">
            <div>
              <h3>新建实例</h3>
              <p>先创建实例元数据，配置细节在右侧详情里维护。</p>
            </div>
          </div>
          {createErrorText ? <p className="err-text">{createErrorText}</p> : null}
          <div className="resource-center-form-grid">
            <label className="field">
              <span className="field-label">实例名称</span>
              <input className="field-input" value={createDraft.name} onChange={(event) => setCreateDraft((current) => ({ ...current, name: event.target.value }))} />
            </label>
            <label className="field">
              <span className="field-label">实例 slug</span>
              <input className="field-input" value={createDraft.slug} onChange={(event) => setCreateDraft((current) => ({ ...current, slug: event.target.value }))} />
            </label>
            <label className="field resource-center-form-span-2">
              <span className="field-label">实例描述</span>
              <textarea className="field-input textarea" value={createDraft.description} onChange={(event) => setCreateDraft((current) => ({ ...current, description: event.target.value }))} />
            </label>
            <label className="field">
              <span className="field-label">初始状态</span>
              <select className="field-input" value={createDraft.status} onChange={(event) => setCreateDraft((current) => ({ ...current, status: event.target.value }))}>
                <option value="active">active</option>
                <option value="draft">draft</option>
                <option value="disabled">disabled</option>
              </select>
            </label>
          </div>
          <div className="resource-center-actions">
            <button type="button" className="admin-action-btn" onClick={() => void handleCreate()}>
              创建实例
            </button>
          </div>
        </section>
      ) : null}

      <div className="resource-center-toolbar">
        <label className="field resource-center-search">
          <span className="field-label">搜索实例</span>
          <input className="field-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="名称、slug、描述" />
        </label>
      </div>

      {errorText ? <p className="err-text">{errorText}</p> : null}

      <div className="resource-center-content">
        <aside className="resource-center-sidebar">
          {loading ? <p className="resource-center-subtle">加载实例列表中...</p> : null}
          {!loading && filteredItems.length === 0 ? <p className="resource-center-empty">当前类型还没有实例。</p> : null}
          <div className="resource-center-list">
            {filteredItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={selectedId === item.id ? "resource-center-list-item active" : "resource-center-list-item"}
                onClick={() => setSelectedId(item.id)}
              >
                <strong>{item.name}</strong>
                <span>{item.slug}</span>
                <span className="resource-center-subtle">{item.status}</span>
              </button>
            ))}
          </div>
        </aside>

        <div className="resource-center-detail">
          {detailLoading ? <p className="resource-center-subtle">加载集成详情中...</p> : null}
          {!detailLoading && !detail ? <p className="resource-center-empty">请选择一个集成实例。</p> : null}
          {detail && detail.instance.type === "dingtalk" ? (
            <DingTalkIntegrationView
              instanceId={detail.instance.id}
              onInstanceUpdated={(instance) => {
                setDetail((current) => (current && current.instance.id === instance.id ? { ...current, instance } : current));
                setItems((current) => current.map((item) => (item.id === instance.id ? instance : item)));
              }}
            />
          ) : null}
          {detail && detail.instance.type === "zendesk" ? <ZendeskIntegrationView detail={detail} onUpdated={handleUpdated} /> : null}
          {detail && detail.instance.type === "openai_codex" ? <OpenAICodexIntegrationView detail={detail} onUpdated={handleUpdated} /> : null}
        </div>
      </div>
    </section>
  );
}
