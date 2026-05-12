import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Empty, Input, Select, Space, Spin, Tag, Typography } from "antd";

import { fetchAgentModes, fetchSkillPackages } from "../capability-center/api";
import type { AgentModeRecord, SkillPackageRecord } from "../capability-center/types";
import {
  fetchAdminSkillDraftDetail,
  fetchAdminSkillDrafts,
  publishAdminSkillDraft,
  reviewAdminSkillDraft,
  updateAdminSkillDraftMarkdown
} from "./api";
import type { CodexSkillDraft } from "./types";

const STATUS_OPTIONS = [
  { label: "全部状态", value: "all" },
  { label: "等待审核", value: "pending_review" },
  { label: "需要修改", value: "changes_requested" },
  { label: "已发布", value: "published" },
  { label: "已驳回", value: "rejected" }
];

function formatLocalDateTime(value?: string) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
}

function statusTagColor(status: string) {
  if (status === "published") return "success";
  if (status === "pending_review") return "processing";
  if (status === "changes_requested") return "warning";
  if (status === "rejected") return "error";
  return "default";
}

function statusLabel(status: string) {
  if (status === "published") return "已发布";
  if (status === "pending_review") return "等待审核";
  if (status === "changes_requested") return "需要修改";
  if (status === "rejected") return "已驳回";
  return status;
}

export function SkillDraftReviewView() {
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
      setSelectedDraftId((current) => current || response.drafts[0]?.id || "");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "加载 skill 草稿失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDrafts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const selectedDraftAuthor = selectedDraft?.createdByDisplayName || selectedDraft?.createdByEmail || selectedDraft?.createdByUserId || "-";
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
      setSuccessText("Skill 已发布。用户需要从新会话中使用。");
      await refreshSelected(response.draft);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "发布失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-page-container">
      <div className="admin-page-header">
        <div>
          <Typography.Title level={3} style={{ margin: 0, marginBottom: 8 }}>
            Skill 审核
          </Typography.Title>
          <Typography.Text type="secondary">审核用户从工作台沉淀的可复用 Codex skill；发布后仅新会话加载。</Typography.Text>
        </div>
        <Space>
          <Tag color={pendingCount > 0 ? "processing" : "default"}>待审核 {pendingCount}</Tag>
          <Button onClick={() => void loadDrafts()} loading={loading}>刷新</Button>
        </Space>
      </div>

      {errorText ? <Alert type="error" showIcon className="admin-alert-inline" message={errorText} /> : null}
      {successText ? <Alert type="success" showIcon className="admin-alert-inline" message={successText} /> : null}

      <div className="admin-split-layout">
        <div className="admin-split-master">
          <div style={{ padding: 16, borderBottom: "1px solid var(--admin-color-border)" }}>
            <Select
              value={statusFilter}
              options={STATUS_OPTIONS}
              onChange={setStatusFilter}
              style={{ width: "100%" }}
            />
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
                    作者：{draft.createdByDisplayName || draft.createdByEmail || draft.createdByUserId}
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
                    <Typography.Text type="secondary">发布后用户需要点击状态卡的“新会话使用”，或手动新建会话后选择该 skill。</Typography.Text>
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

export default SkillDraftReviewView;
