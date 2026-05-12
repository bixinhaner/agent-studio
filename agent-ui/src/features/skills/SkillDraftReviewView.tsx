import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Empty, Input, Select, Space, Spin, Tabs, Tag, Typography } from "antd";

import { fetchAgentModes, fetchSkillPackages } from "../capability-center/api";
import type { AgentModeRecord, SkillPackageRecord } from "../capability-center/types";
import {
  fetchAdminManagedSkills,
  fetchAdminSkillDraftDetail,
  fetchAdminSkillDrafts,
  publishAdminSkillDraft,
  removeAdminManagedSkill,
  reviewAdminSkillDraft,
  shareAdminManagedSkill,
  updateAdminManagedSkillStatus,
  updateAdminSkillDraftMarkdown
} from "./api";
import type { CodexManagedSkill, CodexSkillDraft } from "./types";

const REVIEW_STATUS_OPTIONS = [
  { label: "全部状态", value: "all" },
  { label: "等待审核", value: "pending_review" },
  { label: "需要修改", value: "changes_requested" },
  { label: "已发布", value: "published" },
  { label: "已驳回", value: "rejected" }
];

const MANAGED_STATUS_OPTIONS = [
  { label: "全部状态", value: "all" },
  { label: "Active", value: "active" },
  { label: "Disabled", value: "disabled" },
  { label: "Archived", value: "archived" }
];

const MANAGED_SCOPE_OPTIONS = [
  { label: "全部范围", value: "all" },
  { label: "Private", value: "private" },
  { label: "Agent Mode", value: "agent_mode" },
  { label: "Team", value: "team" },
  { label: "Organization", value: "org" }
];

function formatLocalDateTime(value?: string) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
}

function statusTagColor(status: string) {
  if (status === "published" || status === "active") return "success";
  if (status === "pending_review") return "processing";
  if (status === "changes_requested") return "warning";
  if (status === "disabled") return "default";
  if (status === "rejected" || status === "archived") return "error";
  return "default";
}

function statusLabel(status: string) {
  if (status === "published") return "已发布";
  if (status === "pending_review") return "等待审核";
  if (status === "changes_requested") return "需要修改";
  if (status === "rejected") return "已驳回";
  if (status === "active") return "Active";
  if (status === "disabled") return "Disabled";
  if (status === "archived") return "Archived";
  return status;
}

function scopeLabel(scope?: string) {
  if (scope === "private") return "Private";
  if (scope === "agent_mode") return "Agent Mode";
  if (scope === "team") return "Team";
  if (scope === "org") return "Organization";
  return scope || "-";
}

function actorLabel(record: {
  createdByDisplayName?: string;
  createdByEmail?: string;
  createdByUserId?: string;
}) {
  return record.createdByDisplayName || record.createdByEmail || record.createdByUserId || "-";
}

function metadataString(metadata: unknown, key: string): string {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

function ManagedSkillRegistryPanel() {
  const [skills, setSkills] = useState<CodexManagedSkill[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [scopeFilter, setScopeFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");
  const [skillPackages, setSkillPackages] = useState<SkillPackageRecord[]>([]);
  const [agentModes, setAgentModes] = useState<AgentModeRecord[]>([]);
  const [selectedSkillPackageId, setSelectedSkillPackageId] = useState<string | undefined>();
  const [selectedAgentModeIds, setSelectedAgentModeIds] = useState<string[]>([]);
  const [activationPrompt, setActivationPrompt] = useState("");

  const loadSkills = async () => {
    setLoading(true);
    setErrorText("");
    try {
      const response = await fetchAdminManagedSkills();
      setSkills(response.skills);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "加载 Skill Registry 失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSkills();
  }, []);

  useEffect(() => {
    let active = true;
    async function loadBindings() {
      try {
        const [packageResponse, modeResponse] = await Promise.all([fetchSkillPackages(), fetchAgentModes()]);
        if (!active) return;
        setSkillPackages(packageResponse.skillPackages);
        setAgentModes(modeResponse.agentModes);
      } catch {
        // Sharing remains visible; a failed binding load will surface when the admin retries.
      }
    }
    void loadBindings();
    return () => {
      active = false;
    };
  }, []);

  const filteredSkills = useMemo(
    () =>
      skills.filter((skill) => {
        if (statusFilter !== "all" && skill.status !== statusFilter) return false;
        if (scopeFilter !== "all" && (skill.scope || "") !== scopeFilter) return false;
        return true;
      }),
    [scopeFilter, skills, statusFilter]
  );

  useEffect(() => {
    if (filteredSkills.some((skill) => skill.id === selectedSkillId)) return;
    setSelectedSkillId(filteredSkills[0]?.id || "");
  }, [filteredSkills, selectedSkillId]);

  const selectedSkill = filteredSkills.find((skill) => skill.id === selectedSkillId) || null;
  const privateCount = useMemo(() => skills.filter((skill) => skill.scope === "private").length, [skills]);

  useEffect(() => {
    setSelectedSkillPackageId(undefined);
    setSelectedAgentModeIds([]);
    setActivationPrompt(
      selectedSkill
        ? `当用户需要执行 ${selectedSkill.displayName || selectedSkill.skillName} 这类可复用流程时使用该 skill。`
        : ""
    );
  }, [selectedSkill?.id]);

  const handleSetStatus = async (status: "active" | "disabled" | "archived") => {
    if (!selectedSkill) return;
    setSaving(true);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await updateAdminManagedSkillStatus({
        id: selectedSkill.id,
        status
      });
      setSkills((current) => current.map((skill) => (skill.id === response.skill.id ? response.skill : skill)));
      setSuccessText(`Skill 状态已更新为 ${statusLabel(response.skill.status)}`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "更新 Skill 状态失败");
    } finally {
      setSaving(false);
    }
  };

  const handleShareSkill = async () => {
    if (!selectedSkill) return;
    if (selectedAgentModeIds.length === 0) {
      setErrorText("请选择至少一个 Agent Mode 作为共享范围");
      setSuccessText("");
      return;
    }
    setSharing(true);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await shareAdminManagedSkill({
        id: selectedSkill.id,
        activationPrompt,
        skillPackageId: selectedSkillPackageId,
        agentModeIds: selectedAgentModeIds
      });
      setSkills((current) => {
        const exists = current.some((skill) => skill.id === response.managedSkill.id);
        if (exists) {
          return current.map((skill) => (skill.id === response.managedSkill.id ? response.managedSkill : skill));
        }
        return [response.managedSkill, ...current];
      });
      setStatusFilter("all");
      setScopeFilter("all");
      setSelectedSkillId(response.managedSkill.id);
      setSuccessText("Skill 已共享到 Agent Mode。用户需要新建会话后才能看到新的可用范围。");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "共享 Skill 失败");
    } finally {
      setSharing(false);
    }
  };

  const handleRemoveSkill = async () => {
    if (!selectedSkill) return;
    const confirmed = window.confirm(
      selectedSkill.scope === "private"
        ? "Remove this installed skill? The author will no longer see it in new chats."
        : "Remove this shared skill? It will be unbound from Skill Packages and unavailable in new chats."
    );
    if (!confirmed) return;
    setRemoving(true);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await removeAdminManagedSkill({
        id: selectedSkill.id,
        reason: "Removed from Skill Management"
      });
      setSkills((current) => current.map((skill) => (skill.id === response.skill.id ? response.skill : skill)));
      setSuccessText("Skill 已移除。文件已移出加载目录，新的会话不会再加载它。");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "移除 Skill 失败");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="admin-page-container" style={{ paddingTop: 0 }}>
      {errorText ? <Alert type="error" showIcon className="admin-alert-inline" message={errorText} /> : null}
      {successText ? <Alert type="success" showIcon className="admin-alert-inline" message={successText} /> : null}

      <div className="admin-page-header" style={{ marginTop: 4 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0, marginBottom: 8 }}>
            Installed Skills
          </Typography.Title>
          <Typography.Text type="secondary">
            查看已安装到 Codex skill 目录的标准 Skills。Private skill 默认仅作者新会话可用；共享范围继续复用 Agent Mode / Skill Package 机制。
          </Typography.Text>
        </div>
        <Space>
          <Tag color={privateCount > 0 ? "processing" : "default"}>Private {privateCount}</Tag>
          <Button onClick={() => void loadSkills()} loading={loading}>刷新</Button>
        </Space>
      </div>

      <div className="admin-split-layout">
        <div className="admin-split-master">
          <div style={{ padding: 16, borderBottom: "1px solid var(--admin-color-border)", display: "grid", gap: 12 }}>
            <Select value={statusFilter} options={MANAGED_STATUS_OPTIONS} onChange={setStatusFilter} style={{ width: "100%" }} />
            <Select value={scopeFilter} options={MANAGED_SCOPE_OPTIONS} onChange={setScopeFilter} style={{ width: "100%" }} />
          </div>
          <div className="admin-master-list">
            {loading ? (
              <div style={{ textAlign: "center", padding: "40px 0" }}><Spin size="small" /></div>
            ) : filteredSkills.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无已安装 Skill" />
            ) : (
              filteredSkills.map((skill) => (
                <div
                  key={skill.id}
                  className={`admin-master-item ${selectedSkillId === skill.id ? "active" : ""}`}
                  onClick={() => setSelectedSkillId(skill.id)}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <strong>{skill.displayName || skill.skillName}</strong>
                    <Tag color={statusTagColor(skill.status)} style={{ margin: 0 }}>{statusLabel(skill.status)}</Tag>
                  </div>
                  <div style={{ marginTop: 6, color: "var(--admin-color-subtle)", fontSize: 12 }}>
                    {skill.skillName}
                  </div>
                  <div style={{ marginTop: 8, color: "var(--admin-color-subtle)", fontSize: 12 }}>
                    作者：{actorLabel(skill)} · 范围：{scopeLabel(skill.scope)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="admin-split-detail">
          <div style={{ height: "100%", overflow: "auto", padding: 16 }}>
            {!selectedSkill ? (
              <div className="resource-center-placeholder empty">
                <h3>Skill Registry</h3>
                <p>请选择左侧 Skill 查看详情。</p>
              </div>
            ) : (
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <Card size="small" className="antd-admin-card">
                  <div className="resource-center-section-header">
                    <div>
                      <h3>{selectedSkill.displayName || selectedSkill.skillName}</h3>
                      <p>{selectedSkill.description || "未填写描述"}</p>
                    </div>
                    <Tag color={statusTagColor(selectedSkill.status)}>{statusLabel(selectedSkill.status)}</Tag>
                  </div>
                  <div className="capability-center-summary-grid">
                    <div>
                      <span className="field-label">作者</span>
                      <p>{actorLabel(selectedSkill)}</p>
                    </div>
                    <div>
                      <span className="field-label">范围</span>
                      <p>{scopeLabel(selectedSkill.scope)}</p>
                    </div>
                    <div>
                      <span className="field-label">版本</span>
                      <p>{selectedSkill.version}</p>
                    </div>
                    <div>
                      <span className="field-label">发布时间</span>
                      <p>{formatLocalDateTime(selectedSkill.publishedAt)}</p>
                    </div>
                    <div>
                      <span className="field-label">目录路径</span>
                      <p style={{ wordBreak: "break-all" }}>{selectedSkill.publishedPath}</p>
                    </div>
                    <div>
                      <span className="field-label">来源线程</span>
                      <p>{metadataString(selectedSkill.metadata, "sourceThreadId") || "-"}</p>
                    </div>
                  </div>
                  {selectedSkill.checksum ? (
                    <Typography.Text type="secondary">Checksum: {selectedSkill.checksum}</Typography.Text>
                  ) : null}
                </Card>

                <Card size="small" title="治理动作" className="antd-admin-card">
                  <Space direction="vertical" size={12} style={{ width: "100%" }}>
                    <Typography.Text type="secondary">
                      Disabled 后，该 Skill 不会进入新的工作台会话 runtime options。已经启动的旧会话不会热切更新。
                      移除 Skill 会同时把文件移出加载目录；共享 Skill 还会从 Skill Package 中解绑。
                    </Typography.Text>
                    <Space wrap>
                      {selectedSkill.status !== "active" ? (
                        <Button type="primary" loading={saving} onClick={() => void handleSetStatus("active")}>
                          启用
                        </Button>
                      ) : (
                        <Button loading={saving} onClick={() => void handleSetStatus("disabled")}>
                          禁用
                        </Button>
                      )}
                      {selectedSkill.status !== "archived" ? (
                        <Button danger loading={saving} onClick={() => void handleSetStatus("archived")}>
                          归档
                        </Button>
                      ) : null}
                      {selectedSkill.status !== "archived" ? (
                        <Button danger loading={removing} onClick={() => void handleRemoveSkill()}>
                          移除 Skill
                        </Button>
                      ) : null}
                    </Space>
                  </Space>
                </Card>

                <Card size="small" title="共享范围" className="antd-admin-card">
                  <Space direction="vertical" size={12} style={{ width: "100%" }}>
                    <Typography.Text type="secondary">
                      默认安装仅作者可用。共享会创建一份 Agent Mode 范围的受管 Skill，并复用现有 Skill Package / Agent Mode 权限机制。
                    </Typography.Text>
                    <label className="field">
                      <span className="field-label">默认触发提示词</span>
                      <Input.TextArea
                        value={activationPrompt}
                        rows={3}
                        disabled={sharing || selectedSkill.status !== "active"}
                        onChange={(event) => setActivationPrompt(event.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">绑定到已有 Skill Package（可选）</span>
                      <Select
                        allowClear
                        value={selectedSkillPackageId}
                        options={skillPackages.map((item) => ({ label: item.name, value: item.id }))}
                        onChange={setSelectedSkillPackageId}
                        placeholder="不选则自动创建"
                        disabled={sharing || selectedSkill.status !== "active"}
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">共享到 Agent Mode</span>
                      <Select
                        mode="multiple"
                        value={selectedAgentModeIds}
                        options={agentModes.map((item) => ({ label: item.name, value: item.id }))}
                        onChange={setSelectedAgentModeIds}
                        placeholder="选择用户在哪些 Agent Mode 中可见"
                        disabled={sharing || selectedSkill.status !== "active"}
                      />
                    </label>
                    <Space wrap>
                      <Button
                        type="primary"
                        loading={sharing}
                        disabled={selectedSkill.status !== "active" || selectedAgentModeIds.length === 0}
                        onClick={() => void handleShareSkill()}
                      >
                        {selectedSkill.scope === "private" ? "共享 Skill" : "更新共享绑定"}
                      </Button>
                    </Space>
                    <Typography.Text type="secondary">
                      可见用户仍由被绑定 Agent Mode 和 Skill Package 的现有权限策略决定；已打开的旧会话不会热更新。
                    </Typography.Text>
                  </Space>
                </Card>
              </Space>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SkillReviewQueuePanel() {
  const [drafts, setDrafts] = useState<CodexSkillDraft[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [selectedDraft, setSelectedDraft] = useState<CodexSkillDraft | null>(null);
  const [skillMd, setSkillMd] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending_review");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [activationPrompt, setActivationPrompt] = useState("");
  const [skillPackages, setSkillPackages] = useState<SkillPackageRecord[]>([]);
  const [agentModes, setAgentModes] = useState<AgentModeRecord[]>([]);
  const [selectedSkillPackageId, setSelectedSkillPackageId] = useState<string | undefined>();
  const [selectedAgentModeIds, setSelectedAgentModeIds] = useState<string[]>([]);

  const loadDrafts = async () => {
    setLoading(true);
    setErrorText("");
    try {
      const response = await fetchAdminSkillDrafts(statusFilter);
      setDrafts(response.drafts);
      setSelectedDraftId((current) =>
        response.drafts.some((draft) => draft.id === current) ? current : response.drafts[0]?.id || ""
      );
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "加载 skill 草稿失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDrafts();
  }, [statusFilter]);

  useEffect(() => {
    let active = true;
    async function loadBindings() {
      try {
        const [packageResponse, modeResponse] = await Promise.all([fetchSkillPackages(), fetchAgentModes()]);
        if (!active) return;
        setSkillPackages(packageResponse.skillPackages);
        setAgentModes(modeResponse.agentModes);
      } catch {
        // Binding selection is optional; keep review usable.
      }
    }
    void loadBindings();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedDraftId) {
      setSelectedDraft(null);
      setSkillMd("");
      return;
    }
    let active = true;
    setDetailLoading(true);
    setErrorText("");
    void fetchAdminSkillDraftDetail(selectedDraftId)
      .then((response) => {
        if (!active) return;
        setSelectedDraft(response.draft);
        setSkillMd(response.content);
        setReviewNote(response.draft.reviewNote || "");
        setActivationPrompt(
          response.draft.skillName ? `当用户需要执行 ${response.draft.displayName || response.draft.skillName} 这类可复用流程时使用该 skill。` : ""
        );
        setSelectedAgentModeIds([]);
        setSelectedSkillPackageId(undefined);
      })
      .catch((error) => {
        if (!active) return;
        setErrorText(error instanceof Error ? error.message : "读取 skill 草稿失败");
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedDraftId]);

  const validation = selectedDraft?.validation;
  const canEdit = selectedDraft && selectedDraft.status !== "published" && selectedDraft.status !== "archived";
  const selectedDraftAuthor = actorLabel(selectedDraft || {});
  const pendingCount = useMemo(() => drafts.filter((draft) => draft.status === "pending_review").length, [drafts]);

  const refreshSelected = async (nextDraft?: CodexSkillDraft) => {
    await loadDrafts();
    if (nextDraft) {
      setSelectedDraft(nextDraft);
      setSelectedDraftId(nextDraft.id);
    } else if (selectedDraftId) {
      const response = await fetchAdminSkillDraftDetail(selectedDraftId);
      setSelectedDraft(response.draft);
      setSkillMd(response.content);
    }
  };

  const handleSaveSkillMd = async () => {
    if (!selectedDraft) return;
    setSaving(true);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await updateAdminSkillDraftMarkdown(selectedDraft.id, skillMd);
      setSelectedDraft(response.draft);
      setSuccessText("SKILL.md 已保存并重新校验");
      await refreshSelected(response.draft);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存 SKILL.md 失败");
    } finally {
      setSaving(false);
    }
  };

  const handleRequestChanges = async () => {
    if (!selectedDraft) return;
    setSaving(true);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await reviewAdminSkillDraft({
        id: selectedDraft.id,
        action: "changes_requested",
        note: reviewNote
      });
      setSuccessText("已要求作者修改");
      await refreshSelected(response.draft);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "更新审核状态失败");
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async () => {
    if (!selectedDraft) return;
    setSaving(true);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await reviewAdminSkillDraft({
        id: selectedDraft.id,
        action: "reject",
        note: reviewNote
      });
      setSuccessText("已驳回 skill 草稿");
      await refreshSelected(response.draft);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "驳回失败");
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!selectedDraft) return;
    setSaving(true);
    setErrorText("");
    setSuccessText("");
    try {
      const response = await publishAdminSkillDraft({
        id: selectedDraft.id,
        reviewNote,
        activationPrompt,
        skillPackageId: selectedSkillPackageId,
        agentModeIds: selectedAgentModeIds
      });
      setSuccessText(`Skill 已发布到 ${scopeLabel(response.managedSkill.scope)}。用户需要在新会话中使用。`);
      await refreshSelected(response.draft);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "发布失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-page-container" style={{ paddingTop: 0 }}>
      {errorText ? <Alert type="error" showIcon className="admin-alert-inline" message={errorText} /> : null}
      {successText ? <Alert type="success" showIcon className="admin-alert-inline" message={successText} /> : null}

      <div className="admin-page-header" style={{ marginTop: 4 }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0, marginBottom: 8 }}>
            Review Queue
          </Typography.Title>
          <Typography.Text type="secondary">
            审核需要提升到 Agent Mode / 组织共享范围的 Skill 草稿。发布后仍然只会在新会话里加载。
          </Typography.Text>
        </div>
        <Space>
          <Tag color={pendingCount > 0 ? "processing" : "default"}>待审核 {pendingCount}</Tag>
          <Button onClick={() => void loadDrafts()} loading={loading}>刷新</Button>
        </Space>
      </div>

      <div className="admin-split-layout">
        <div className="admin-split-master">
          <div style={{ padding: 16, borderBottom: "1px solid var(--admin-color-border)" }}>
            <Select value={statusFilter} options={REVIEW_STATUS_OPTIONS} onChange={setStatusFilter} style={{ width: "100%" }} />
          </div>
          <div className="admin-master-list">
            {loading ? (
              <div style={{ textAlign: "center", padding: "40px 0" }}><Spin size="small" /></div>
            ) : drafts.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 skill 草稿" />
            ) : (
              drafts.map((draft) => (
                <div
                  key={draft.id}
                  className={`admin-master-item ${selectedDraftId === draft.id ? "active" : ""}`}
                  onClick={() => setSelectedDraftId(draft.id)}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <strong>{draft.displayName || draft.skillName || draft.id}</strong>
                    <Tag color={statusTagColor(draft.status)} style={{ margin: 0 }}>{statusLabel(draft.status)}</Tag>
                  </div>
                  <div style={{ marginTop: 6, color: "var(--admin-color-subtle)", fontSize: 12 }}>
                    {draft.skillName || draft.slug}
                  </div>
                  <div style={{ marginTop: 8, color: "var(--admin-color-subtle)", fontSize: 12 }}>
                    作者：{actorLabel(draft)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="admin-split-detail">
          <div style={{ height: "100%", overflow: "auto", padding: 16 }}>
            {!selectedDraft ? (
              <div className="resource-center-placeholder empty">
                <h3>Skill 草稿</h3>
                <p>请选择左侧草稿进行审核。</p>
              </div>
            ) : detailLoading ? (
              <div style={{ textAlign: "center", padding: 48 }}><Spin /></div>
            ) : (
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <Card size="small" className="antd-admin-card">
                  <div className="resource-center-section-header">
                    <div>
                      <h3>{selectedDraft.displayName || selectedDraft.skillName}</h3>
                      <p>{selectedDraft.description || "未填写描述"}</p>
                    </div>
                    <Tag color={statusTagColor(selectedDraft.status)}>{statusLabel(selectedDraft.status)}</Tag>
                  </div>
                  <div className="capability-center-summary-grid">
                    <div>
                      <span className="field-label">作者</span>
                      <p>{selectedDraftAuthor}</p>
                    </div>
                    <div>
                      <span className="field-label">创建时间</span>
                      <p>{formatLocalDateTime(selectedDraft.createdAt)}</p>
                    </div>
                    <div>
                      <span className="field-label">版本</span>
                      <p>{selectedDraft.version}</p>
                    </div>
                    <div>
                      <span className="field-label">来源</span>
                      <p>{selectedDraft.sourceManagedSkillId ? "已发布 Skill 的新版本" : "工作台新建"}</p>
                    </div>
                  </div>
                  {validation ? (
                    <Alert
                      type={validation.ok ? (validation.warnings.length > 0 ? "warning" : "success") : "error"}
                      showIcon
                      className="admin-alert-inline"
                      message={validation.ok ? "校验通过" : "校验失败"}
                      description={[...validation.errors, ...validation.warnings].join("\n") || "结构符合发布要求"}
                    />
                  ) : null}
                </Card>

                <Card size="small" title="SKILL.md" className="antd-admin-card">
                  <Input.TextArea
                    value={skillMd}
                    disabled={!canEdit || saving}
                    autoSize={{ minRows: 16, maxRows: 28 }}
                    onChange={(event) => setSkillMd(event.target.value)}
                    style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
                  />
                  <div style={{ marginTop: 12 }}>
                    <Button disabled={!canEdit} loading={saving} onClick={() => void handleSaveSkillMd()}>
                      保存并校验
                    </Button>
                  </div>
                </Card>

                <Card size="small" title="审核发布" className="antd-admin-card">
                  <Space direction="vertical" size={12} style={{ width: "100%" }}>
                    <label className="field">
                      <span className="field-label">审核备注</span>
                      <Input.TextArea value={reviewNote} rows={3} disabled={saving} onChange={(event) => setReviewNote(event.target.value)} />
                    </label>
                    <label className="field">
                      <span className="field-label">默认触发提示词</span>
                      <Input.TextArea
                        value={activationPrompt}
                        rows={3}
                        disabled={saving}
                        onChange={(event) => setActivationPrompt(event.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">绑定到已有 Skill Package（可选）</span>
                      <Select
                        allowClear
                        value={selectedSkillPackageId}
                        options={skillPackages.map((item) => ({ label: item.name, value: item.id }))}
                        onChange={setSelectedSkillPackageId}
                        placeholder="不选则自动创建"
                        disabled={saving}
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">发布后挂到 Agent Mode</span>
                      <Select
                        mode="multiple"
                        value={selectedAgentModeIds}
                        options={agentModes.map((item) => ({ label: item.name, value: item.id }))}
                        onChange={setSelectedAgentModeIds}
                        placeholder="默认尝试挂到来源会话的模式；也可以手动选择"
                        disabled={saving}
                      />
                    </label>
                    <Space wrap>
                      <Button onClick={() => void handleRequestChanges()} disabled={!canEdit} loading={saving}>
                        要求修改
                      </Button>
                      <Button danger onClick={() => void handleReject()} disabled={!canEdit} loading={saving}>
                        驳回
                      </Button>
                      <Button type="primary" onClick={() => void handlePublish()} disabled={!canEdit} loading={saving}>
                        发布 Skill
                      </Button>
                    </Space>
                    <Typography.Text type="secondary">发布后用户需要新建会话，Agent Studio 才会把新的共享 Skill 装入 runtime。</Typography.Text>
                  </Space>
                </Card>
              </Space>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SkillDraftReviewView() {
  return (
    <div className="admin-page-container">
      <div className="admin-page-header">
        <div>
          <Typography.Title level={3} style={{ margin: 0, marginBottom: 8 }}>
            Skill 管理
          </Typography.Title>
          <Typography.Text type="secondary">
            管理用户通过 skill-creator 生成并安装的标准 Codex Skills；默认仅新会话加载。Private 安装直接进入 Registry，共享发布继续走审核队列。
          </Typography.Text>
        </div>
      </div>

      <Tabs
        defaultActiveKey="registry"
        items={[
          {
            key: "registry",
            label: "Installed Skills",
            children: <ManagedSkillRegistryPanel />
          },
          {
            key: "review-queue",
            label: "Review Queue",
            children: <SkillReviewQueuePanel />
          }
        ]}
      />
    </div>
  );
}

export default SkillDraftReviewView;
