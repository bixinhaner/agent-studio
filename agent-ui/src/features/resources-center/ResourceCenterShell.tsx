import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Input, Spin, Tag, Typography } from "antd";

import { createKnowledgeSet, fetchKnowledgeSets } from "./api";
import { KnowledgeSetDetailView } from "./KnowledgeSetDetailView";
import type {
  KnowledgeSetRecord,
  ResourceStatusFilter
} from "./types";

type CreatePanelState = {
  name: string;
  description: string;
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
  const [createPanel, setCreatePanel] = useState<CreatePanelState | null>(null);
  const [createSaving, setCreateSaving] = useState(false);
  const [createErrorText, setCreateErrorText] = useState("");

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
  }, []);

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
    if (createPanel) return;
    if (filteredKnowledgeSets.length === 0) {
      setSelectedKnowledgeSetId(null);
      return;
    }
    const stillExists = filteredKnowledgeSets.some((item) => item.id === selectedKnowledgeSetId);
    if (!stillExists) {
      setSelectedKnowledgeSetId(filteredKnowledgeSets[0].id);
    }
  }, [createPanel, filteredKnowledgeSets, selectedKnowledgeSetId]);

  const activeListCount = filteredKnowledgeSets.length;
  const activeEnabledCount = filteredKnowledgeSets.filter((item) => item.status === "active").length;
  const activeDisabledCount = Math.max(activeListCount - activeEnabledCount, 0);

  function handleKnowledgeSetUpdated(updatedKnowledgeSet: KnowledgeSetRecord) {
    setKnowledgeSets((current) =>
      current.map((knowledgeSet) =>
        knowledgeSet.id === updatedKnowledgeSet.id ? updatedKnowledgeSet : knowledgeSet
      )
    );
  }

  function openCreatePanel() {
    setCreatePanel(createInitialPanelState());
    setCreateErrorText("");
  }

  function closeCreatePanel() {
    setCreatePanel(null);
    setCreateErrorText("");
    setCreateSaving(false);
  }

  async function handleCreateSave() {
    if (!createPanel) return;
    const trimmedName = createPanel.name.trim();
    if (!trimmedName) {
      setCreateErrorText("请填写资料集名称");
      return;
    }
    setCreateSaving(true);
    setCreateErrorText("");
    try {
      const response = await createKnowledgeSet({
        name: trimmedName,
        description: createPanel.description.trim()
      });
      setKnowledgeSets((current) => [...current, response.knowledgeSet]);
      setSelectedKnowledgeSetId(response.knowledgeSet.id);
      setSearch("");
      setStatusFilter("all");
      closeCreatePanel();
    } catch (error) {
      setCreateErrorText(error instanceof Error ? error.message : "创建资料集失败");
      setCreateSaving(false);
    }
  }

  return (
    <Card className="admin-card resource-center-shell antd-admin-card">
      <div className="admin-section-header">
        <div>
          <Typography.Title level={4} className="admin-card-heading">
            资料配置中心
          </Typography.Title>
          <Typography.Paragraph>统一管理资料集、文件清单与资源授权策略。</Typography.Paragraph>
        </div>
        <div className="resource-center-create-row">
          <Button type="primary" onClick={openCreatePanel}>
            新建资料集
          </Button>
        </div>
      </div>

      <section className="resource-center-hero">
        <div>
          <p className="auth-eyebrow">Agent Studio Knowledge Sets</p>
          <Typography.Title level={5} className="admin-card-subheading">
            资料集管理
          </Typography.Title>
          <Typography.Paragraph>维护资料元数据、来源配置、文件列表和访问授权。</Typography.Paragraph>
        </div>
        <div className="resource-center-hero-meta">
          <Tag color="blue">当前类型：资料集</Tag>
          <Tag>{selectedKnowledgeSet ? `已选：${selectedKnowledgeSet.name}` : "未选择"}</Tag>
          <Tag>最近更新：{formatLocalDateTime(selectedKnowledgeSet?.updatedAt)}</Tag>
        </div>
      </section>

      <div className="resource-center-toolbar">
        <label className="field resource-center-search">
          <span className="field-label">搜索资料集</span>
          <Input
            aria-label="搜索资料集"
            placeholder="名称或描述"
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

      </div>

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

      {loading ? <Spin size="small" /> : null}
      {errorText ? <Alert className="admin-alert-inline" type="error" showIcon message={errorText} /> : null}

      <div className="resource-center-body">
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
                      onClick={() => setSelectedKnowledgeSetId(knowledgeSet.id)}
                    >
                      <span className="resource-center-item-title-row">
                        <span className="resource-center-item-title">{knowledgeSet.name}</span>
                        <Tag color={knowledgeSet.status === "active" ? "success" : "default"}>
                          {knowledgeSet.status}
                        </Tag>
                      </span>
                      <span className="resource-center-item-meta">
                        <Tag>{knowledgeSet.sourceType === "managed_upload" ? "托管上传" : knowledgeSet.sourceType}</Tag>
                      </span>
                      <span className="resource-center-item-note">
                        {knowledgeSetCardSummary(knowledgeSet)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {filteredKnowledgeSets.length === 0 ? (
            <p className="resource-center-empty">当前筛选条件下没有资料集。</p>
          ) : null}
        </aside>

        <section className="resource-center-detail">
          {createPanel ? (
            <section className="resource-center-section resource-center-create-panel">
              <div className="resource-center-section-header">
                <div>
                  <h3>新建资料集</h3>
                  <p>只需填写名称。系统会自动生成标识并默认启用，创建后进入详情继续上传资料。</p>
                </div>
              </div>

              {createErrorText ? (
                <Alert className="admin-alert-inline" type="error" showIcon message={createErrorText} />
              ) : null}

              <div className="resource-center-form-grid">
                <label className="field resource-center-form-span-2">
                  <span className="field-label">新建资料集名称</span>
                  <input
                    className="field-input"
                    aria-label="新建资料集名称"
                    value={createPanel.name}
                    disabled={createSaving}
                    onChange={(event) =>
                      setCreatePanel((current) => (current ? { ...current, name: event.target.value } : current))
                    }
                  />
                </label>

                <label className="field">
                  <span className="field-label">资料来源</span>
                  <input className="field-input" aria-label="资料来源" value="托管上传" disabled />
                </label>

                <label className="field">
                  <span className="field-label">默认状态</span>
                  <input className="field-input" aria-label="默认状态" value="active" disabled />
                </label>

                <label className="field resource-center-form-span-2">
                  <span className="field-label">新建资料集描述</span>
                  <textarea
                    className="field-input textarea"
                    aria-label="新建资料集描述"
                    value={createPanel.description}
                    disabled={createSaving}
                    onChange={(event) =>
                      setCreatePanel((current) =>
                        current ? { ...current, description: event.target.value } : current
                      )
                    }
                  />
                </label>
              </div>

              <div className="resource-center-actions">
                <Button type="primary" disabled={createSaving} onClick={() => void handleCreateSave()}>
                  {createSaving ? "创建中..." : "保存新资料集"}
                </Button>
                <Button disabled={createSaving} onClick={closeCreatePanel}>
                  取消创建
                </Button>
              </div>
            </section>
          ) : null}

          {!createPanel && selectedKnowledgeSet ? (
            <KnowledgeSetDetailView
              knowledgeSet={selectedKnowledgeSet}
              onKnowledgeSetUpdated={handleKnowledgeSetUpdated}
            />
          ) : null}

          {!createPanel && !selectedKnowledgeSet ? (
            <div className="resource-center-placeholder empty">
              <h3>资料集详情</h3>
              <p>请选择左侧资料集以继续配置。</p>
            </div>
          ) : null}
        </section>
      </div>
    </Card>
  );
}
