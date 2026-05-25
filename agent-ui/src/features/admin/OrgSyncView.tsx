import { useEffect, useState } from "react";
import { Alert, Button, Card, Empty, Input, Space, Spin, Tag, Typography } from "antd";
import { Activity, Building, ChevronDown, ChevronRight, Clock, ListTree, RefreshCcw, UserPlus, Zap } from "lucide-react";

import {
  fetchOrgSyncConfig,
  fetchOrgSyncJobDiffs,
  fetchOrgSyncJobs,
  triggerDepartmentOrgSync,
  triggerFullOrgSync,
  triggerUserOrgSync
} from "./api";
import type { OrgSyncConfig, OrgSyncDiff, OrgSyncJob } from "./types";

type JobDiffState = {
  expanded: boolean;
  loading: boolean;
  showAll: boolean;
  errorText?: string;
  diffs?: OrgSyncDiff[];
};

type SummaryChip = {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "warning" | "danger";
};

type HiddenChange = {
  text: string;
  reason: string;
};

type FieldChangeRows = {
  visible: string[];
  hidden: HiddenChange[];
};

type FormattedDiff = {
  id: string;
  entityType: string;
  title: string;
  meta: string;
  changes: string[];
  hiddenChanges: HiddenChange[];
};

type HiddenChangeSummary = {
  count: number;
  reasons: Array<{ label: string; count: number }>;
};

const ENTITY_LABELS: Record<string, string> = {
  user: "员工",
  department: "部门",
  membership: "部门关系"
};

const CHANGE_LABELS: Record<string, string> = {
  created: "新增",
  updated: "更新",
  disabled: "禁用",
  restored: "恢复",
  removed: "移除",
  primary_changed: "主部门变更"
};

const USER_FIELD_LABELS: Record<string, string> = {
  displayName: "姓名",
  email: "邮箱",
  userId: "钉钉 UserID",
  unionId: "钉钉 UnionID",
  openId: "钉钉 OpenID",
  corpId: "Corp ID",
  status: "账号状态",
  statusSource: "状态来源",
  syncState: "钉钉状态",
  manualDisabled: "手动禁用",
  departmentExternalIds: "所属部门 ID",
  primaryDepartmentExternalId: "主部门 ID"
};

const DEPARTMENT_FIELD_LABELS: Record<string, string> = {
  externalId: "部门 ID",
  name: "部门名称",
  parentExternalId: "上级部门 ID",
  sortOrder: "排序",
  status: "状态"
};

const USER_VISIBLE_FIELDS = [
  "displayName",
  "email",
  "userId",
  "status",
  "syncState",
  "statusSource",
  "manualDisabled",
  "departmentExternalIds",
  "primaryDepartmentExternalId",
  "openId",
  "corpId",
  "unionId"
];

const DEPARTMENT_VISIBLE_FIELDS = ["name", "externalId", "parentExternalId", "sortOrder", "status"];
const USER_SYSTEM_FIELDS = new Set(["openId", "corpId", "unionId"]);
const PREVIEW_DIFF_LIMIT = 8;

function formatLocalTime(value: string | null | undefined): string {
  if (!value) return "未执行";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString();
}

function formatCadence(intervalMinutes: number): string {
  if (intervalMinutes === 24 * 60) return "每日同步";
  if (intervalMinutes % (24 * 60) === 0) return `每 ${intervalMinutes / (24 * 60)} 天同步`;
  if (intervalMinutes % 60 === 0) return `每 ${intervalMinutes / 60} 小时同步`;
  return `每 ${intervalMinutes} 分钟同步`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "内容不可用";
  }
}

function isSucceededStatus(status: string | undefined): boolean {
  return status === "succeeded" || status === "success";
}

function getJobStatusText(status: string | undefined): string {
  if (isSucceededStatus(status)) return "同步成功";
  if (status === "running") return "进行中";
  if (status === "pending") return "排队中";
  if (status === "failed") return "异常结束";
  return status || "未知状态";
}

function getJobStatusTagColor(status: string | undefined): string {
  if (isSucceededStatus(status)) return "success";
  if (status === "running" || status === "pending") return "processing";
  return "error";
}

function formatScope(job: OrgSyncJob): string {
  if (job.scopeType === "department") return `部门 ${job.scopeExternalId || "未指定"}`;
  if (job.scopeType === "user") return `用户 ${job.scopeExternalId || "未指定"}`;
  return "全部通讯录";
}

function formatScopeTitle(scopeType: string | undefined): string {
  if (scopeType === "department") return "部门同步";
  if (scopeType === "user") return "用户同步";
  return "全量同步";
}

function formatTriggerType(triggerType: string | undefined): string {
  if (triggerType === "scheduled") return "定时任务";
  if (triggerType === "manual") return "手动触发";
  return triggerType || "触发方式未知";
}

function formatDuration(job: OrgSyncJob): string {
  const startedAt = job.startedAt || job.createdAt;
  if (!startedAt || !job.finishedAt) return "--";
  const durationMs = new Date(job.finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(durationMs) || durationMs < 0) return "--";
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function getSummaryRecord(job: OrgSyncJob): Record<string, unknown> | undefined {
  return asRecord(job.summary);
}

function getFailureDetail(job: OrgSyncJob): string | undefined {
  const summary = getSummaryRecord(job);
  return asString(summary?.detail) ?? asString(summary?.message);
}

function formatChangeBreakdown(summary: Record<string, unknown> | undefined): string {
  const byChangeType = asRecord(summary?.byChangeType);
  const items = Object.entries(byChangeType ?? {})
    .map(([key, value]) => ({ label: CHANGE_LABELS[key] ?? key, count: asNumber(value) ?? 0 }))
    .filter((item) => item.count > 0);
  if (!items.length) return "无变化";
  return items.map((item) => `${item.label} ${item.count}`).join("、");
}

function formatJobSummaryLine(job: OrgSyncJob): string {
  const failureDetail = getFailureDetail(job);
  if (failureDetail) return `失败原因：${failureDetail}`;
  if (job.status === "running") return "正在拉取钉钉通讯录并计算变化。";
  if (job.status === "pending") return "任务已创建，等待执行。";

  const summary = getSummaryRecord(job);
  if (!summary) return "暂无摘要";
  const total = asNumber(summary.total);
  if (!total) return "未发现通讯录变化。";

  const entityParts = [
    ["department", "部门"],
    ["user", "员工"],
    ["membership", "部门关系"]
  ]
    .map(([key, label]) => ({ label, count: asNumber(summary[key]) ?? 0 }))
    .filter((item) => item.count > 0)
    .map((item) => `${item.label} ${item.count}`);

  return `发现 ${total} 项变化：${entityParts.join("、") || formatChangeBreakdown(summary)}。`;
}

function getSummaryChips(job: OrgSyncJob): SummaryChip[] {
  const summary = getSummaryRecord(job);
  const chips: SummaryChip[] = [
    { label: "耗时", value: formatDuration(job) },
    { label: "范围", value: formatScope(job) },
    { label: "触发", value: formatTriggerType(job.triggerType) }
  ];

  if (!summary) return chips;
  const total = asNumber(summary.total) ?? 0;
  chips.unshift({ label: "变化", value: String(total), tone: total > 0 ? "warning" : "success" });

  for (const key of ["user", "department", "membership"]) {
    const count = asNumber(summary[key]) ?? 0;
    if (count > 0) {
      chips.push({ label: ENTITY_LABELS[key] ?? key, value: String(count) });
    }
  }

  const byChangeType = asRecord(summary.byChangeType);
  for (const [key, value] of Object.entries(byChangeType ?? {})) {
    const count = asNumber(value) ?? 0;
    if (count > 0) {
      chips.push({ label: CHANGE_LABELS[key] ?? key, value: String(count) });
    }
  }
  return chips;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "未设置";
  if (Array.isArray(value)) {
    if (!value.length) return "空";
    return value.map(formatValue).join("、");
  }
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "object") return JSON.stringify(value);
  const text = String(value);
  return text.length > 96 ? `${text.slice(0, 96)}...` : text;
}

function isUnsetValue(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

function looksLikeInternalRecordId(value: unknown): boolean {
  const text = asString(value);
  return Boolean(text && /^c[a-z0-9]{12,}$/i.test(text));
}

function isNoisyDepartmentParentChange(beforeValue: unknown, afterValue: unknown): boolean {
  if (looksLikeInternalRecordId(beforeValue) || looksLikeInternalRecordId(afterValue)) {
    return true;
  }
  const beforeText = asString(beforeValue);
  const afterText = asString(afterValue);
  return (isUnsetValue(beforeValue) && afterText === "1") || (beforeText === "1" && isUnsetValue(afterValue));
}

function getHiddenChangeReason(
  entityType: string,
  field: string,
  beforeValue: unknown,
  afterValue: unknown
): string | undefined {
  if (entityType === "user" && USER_SYSTEM_FIELDS.has(field)) {
    return "钉钉系统标识";
  }
  if (entityType === "department" && field === "parentExternalId" && isNoisyDepartmentParentChange(beforeValue, afterValue)) {
    return "部门父级 ID 标准化";
  }
  return undefined;
}

function fieldChanges(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
  fields: string[],
  labels: Record<string, string>,
  changeType: string,
  entityType: string
): FieldChangeRows {
  const rows: FieldChangeRows = { visible: [], hidden: [] };
  for (const field of fields) {
    const beforeValue = before?.[field];
    const afterValue = after?.[field];
    const hiddenReason = getHiddenChangeReason(entityType, field, beforeValue, afterValue);
    const pushRow = (text: string) => {
      if (hiddenReason) {
        rows.hidden.push({ text, reason: hiddenReason });
      } else {
        rows.visible.push(text);
      }
    };

    if (changeType === "created") {
      if (afterValue !== undefined && afterValue !== null && afterValue !== "") {
        pushRow(`${labels[field] ?? field}：${formatValue(afterValue)}`);
      }
      continue;
    }
    if (changeType === "removed") {
      if (beforeValue !== undefined && beforeValue !== null && beforeValue !== "") {
        pushRow(`${labels[field] ?? field}：${formatValue(beforeValue)}`);
      }
      continue;
    }
    if (!sameValue(beforeValue, afterValue)) {
      pushRow(`${labels[field] ?? field}：${formatValue(beforeValue)} → ${formatValue(afterValue)}`);
    }
  }
  return rows;
}

function formatMembershipSet(payload: Record<string, unknown> | undefined): string {
  const memberships = asArray(payload?.memberships)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      departmentId: asString(item.departmentId) ?? "未知部门",
      isPrimary: item.isPrimary === true
    }));

  if (memberships.length) {
    return memberships
      .map((item) => `${item.isPrimary ? "主部门" : "部门"} ${item.departmentId}`)
      .join("、");
  }

  const departmentIds = asArray(payload?.departmentExternalIds).map(formatValue);
  const primaryDepartmentId = asString(payload?.primaryDepartmentExternalId);
  if (departmentIds.length || primaryDepartmentId) {
    return [
      primaryDepartmentId ? `主部门 ${primaryDepartmentId}` : undefined,
      departmentIds.length ? `部门 ${departmentIds.join("、")}` : undefined
    ].filter(Boolean).join("、");
  }

  return "未设置部门";
}

function formatMembershipChanges(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
  changeType: string
): string[] {
  if (changeType === "created") return [`加入：${formatMembershipSet(after)}`];
  if (changeType === "removed") return [`移除：${formatMembershipSet(before)}`];
  return [`从 ${formatMembershipSet(before)} 调整为 ${formatMembershipSet(after)}`];
}

function resolveDiffTarget(diff: OrgSyncDiff): string {
  const before = asRecord(diff.beforePayload);
  const after = asRecord(diff.afterPayload);
  if (diff.entityType === "department") {
    return asString(after?.name) ?? asString(before?.name) ?? asString(after?.externalId) ?? asString(diff.entityExternalId) ?? "未知部门";
  }
  if (diff.entityType === "membership") {
    return asString(after?.userId) ?? asString(before?.userId) ?? asString(diff.entityExternalId) ?? "未知用户";
  }
  return (
    asString(after?.displayName) ??
    asString(before?.displayName) ??
    asString(after?.email) ??
    asString(before?.email) ??
    asString(after?.userId) ??
    asString(before?.userId) ??
    asString(diff.entityExternalId) ??
    "未知员工"
  );
}

function formatDiff(diff: OrgSyncDiff): FormattedDiff {
  const before = asRecord(diff.beforePayload);
  const after = asRecord(diff.afterPayload);
  const entityLabel = ENTITY_LABELS[diff.entityType] ?? diff.entityType;
  const changeLabel = CHANGE_LABELS[diff.changeType] ?? diff.changeType;
  const target = resolveDiffTarget(diff);
  const idText = diff.entityExternalId ? `ID ${diff.entityExternalId}` : "未记录外部 ID";

  let rows: FieldChangeRows;
  if (diff.entityType === "membership") {
    rows = { visible: formatMembershipChanges(before, after, diff.changeType), hidden: [] };
  } else if (diff.entityType === "department") {
    rows = fieldChanges(before, after, DEPARTMENT_VISIBLE_FIELDS, DEPARTMENT_FIELD_LABELS, diff.changeType, diff.entityType);
  } else {
    rows = fieldChanges(before, after, USER_VISIBLE_FIELDS, USER_FIELD_LABELS, diff.changeType, diff.entityType);
  }

  if (!rows.visible.length && !rows.hidden.length) {
    rows.visible = ["仅同步元数据发生变化。"];
  }

  return {
    id: diff.id,
    entityType: diff.entityType,
    title: `${changeLabel} ${entityLabel} · ${target}`,
    meta: idText,
    changes: rows.visible,
    hiddenChanges: rows.hidden
  };
}

function groupDiffs(diffs: FormattedDiff[]) {
  const order = ["user", "department", "membership", "other"];
  const groups = new Map<string, FormattedDiff[]>();
  for (const diff of diffs) {
    const key = diff.entityType === "user" || diff.entityType === "department" || diff.entityType === "membership" ? diff.entityType : "other";
    groups.set(key, [...(groups.get(key) ?? []), diff]);
  }
  return order
    .map((key) => ({ key, label: ENTITY_LABELS[key] ?? "其他变化", diffs: groups.get(key) ?? [] }))
    .filter((group) => group.diffs.length > 0);
}

function summarizeHiddenChanges(diffs: FormattedDiff[]): HiddenChangeSummary {
  const reasonCounts = new Map<string, number>();
  let count = 0;
  for (const diff of diffs) {
    for (const change of diff.hiddenChanges) {
      count += 1;
      reasonCounts.set(change.reason, (reasonCounts.get(change.reason) ?? 0) + 1);
    }
  }
  return {
    count,
    reasons: [...reasonCounts.entries()].map(([label, reasonCount]) => ({ label, count: reasonCount }))
  };
}

export function OrgSyncView() {
  const [config, setConfig] = useState<OrgSyncConfig | null>(null);
  const [jobs, setJobs] = useState<OrgSyncJob[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [diffStateByJobId, setDiffStateByJobId] = useState<Record<string, JobDiffState>>({});

  async function reload() {
    const [configResponse, jobsResponse] = await Promise.all([fetchOrgSyncConfig(), fetchOrgSyncJobs()]);
    setConfig(configResponse.orgSync);
    setJobs(jobsResponse.jobs);
  }

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setErrorText("");
      try {
        const [configResponse, jobsResponse] = await Promise.all([fetchOrgSyncConfig(), fetchOrgSyncJobs()]);
        if (!active) return;
        setConfig(configResponse.orgSync);
        setJobs(jobsResponse.jobs);
      } catch (error) {
        if (active) setErrorText(error instanceof Error ? error.message : "加载组织同步信息失败");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  async function handleTrigger(run: () => Promise<unknown>) {
    setSubmitting(true);
    setErrorText("");
    try {
      await run();
      await reload();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "触发组织同步失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleJobDiffs(jobId: string) {
    const current = diffStateByJobId[jobId];
    if (current?.expanded) {
      setDiffStateByJobId((state) => ({
        ...state,
        [jobId]: { ...current, expanded: false }
      }));
      return;
    }

    setDiffStateByJobId((state) => ({
      ...state,
      [jobId]: {
        expanded: true,
        loading: !state[jobId]?.diffs,
        showAll: state[jobId]?.showAll ?? false,
        diffs: state[jobId]?.diffs,
        errorText: undefined
      }
    }));

    if (current?.diffs) return;

    try {
      const response = await fetchOrgSyncJobDiffs(jobId);
      setDiffStateByJobId((state) => ({
        ...state,
        [jobId]: {
          ...(state[jobId] ?? { expanded: true, showAll: false }),
          expanded: true,
          loading: false,
          diffs: response.diffs,
          errorText: undefined
        }
      }));
    } catch (error) {
      setDiffStateByJobId((state) => ({
        ...state,
        [jobId]: {
          ...(state[jobId] ?? { expanded: true, showAll: false }),
          expanded: true,
          loading: false,
          errorText: error instanceof Error ? error.message : "加载变化明细失败"
        }
      }));
    }
  }

  function toggleShowAllDiffs(jobId: string) {
    setDiffStateByJobId((state) => {
      const current = state[jobId];
      if (!current) return state;
      return {
        ...state,
        [jobId]: {
          ...current,
          showAll: !current.showAll
        }
      };
    });
  }

  const latestJob = jobs[0];
  const isRunning = latestJob?.status === "running";

  return (
    <Card className="admin-tree-card antd-admin-card" bordered={false} bodyStyle={{ padding: 0 }}>
      <div className="admin-tree-header" style={{ padding: "24px 24px 0 24px" }}>
        <Typography.Title level={4} style={{ margin: "0 0 8px 0", fontSize: 18 }}>
          同步中心
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ margin: 0, fontSize: 13 }}>
          管理与身份提供商的同步任务状态与策略。
        </Typography.Paragraph>
      </div>

      <div className="admin-tree-container" style={{ padding: 24 }}>
        {loading ? <div style={{ textAlign: "center", padding: 48 }}><Spin size="large" /></div> : null}
        {errorText ? <Alert type="error" showIcon message={errorText} style={{ marginBottom: 16 }} /> : null}

        {config && !loading && (
          <>
            <div className="admin-sync-dashboard">
              <div className="admin-sync-stat-card">
                <div className="admin-sync-stat-label"><Clock size={16} /> 自动化策略</div>
                <div className="admin-sync-stat-value" style={{ color: config.enabled ? "var(--admin-color-text)" : "var(--admin-color-subtle)" }}>
                  {config.enabled ? formatCadence(config.intervalMinutes) : "已关闭"}
                </div>
                <div style={{ marginTop: "auto" }}>
                  <Tag color={config.enabled ? "success" : "default"} style={{ borderRadius: 12 }}>
                    {config.enabled ? "Enabled" : "Disabled"}
                  </Tag>
                </div>
              </div>

              <div className="admin-sync-stat-card">
                <div className="admin-sync-stat-label"><Activity size={16} /> 最近任务状态</div>
                {latestJob ? (
                  <>
                    <div className="admin-sync-stat-value">
                      {getJobStatusText(latestJob.status)}
                    </div>
                    <div style={{ marginTop: "auto", fontSize: 12, color: "var(--admin-color-subtle)" }}>
                      耗时: {formatDuration(latestJob)}
                      <br />
                      结束于: {formatLocalTime(latestJob.finishedAt)}
                    </div>
                  </>
                ) : (
                  <div className="admin-sync-stat-value" style={{ color: "var(--admin-color-subtle)" }}>暂无记录</div>
                )}
              </div>
            </div>

            <div style={{ marginBottom: 32 }}>
              <Typography.Title level={5} style={{ fontSize: 15, marginBottom: 16 }}>触发手动同步</Typography.Title>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <Card size="small" style={{ borderRadius: 12, border: "1px solid var(--admin-color-border)", boxShadow: "var(--admin-shadow-sm)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ padding: 8, background: "var(--admin-color-bg)", borderRadius: 8 }}><Zap size={18} color="var(--admin-color-accent)" /></div>
                      <div>
                        <div style={{ fontWeight: 500 }}>全量同步</div>
                        <div style={{ fontSize: 12, color: "var(--admin-color-subtle)" }}>立即同步所有用户与组织架构信息</div>
                      </div>
                    </div>
                    <Button type="primary" loading={submitting || isRunning} onClick={() => handleTrigger(triggerFullOrgSync)}>
                      立即执行
                    </Button>
                  </div>
                </Card>

                <div style={{ display: "flex", gap: 16 }}>
                  <Card size="small" style={{ flex: 1, borderRadius: 12, border: "1px solid var(--admin-color-border)", boxShadow: "var(--admin-shadow-sm)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                      <div style={{ padding: 8, background: "var(--admin-color-bg)", borderRadius: 8 }}><Building size={18} color="var(--admin-color-subtle)" /></div>
                      <div style={{ fontWeight: 500 }}>部门增量同步</div>
                    </div>
                    <Space.Compact style={{ width: "100%" }}>
                      <Input
                        placeholder="输入部门 External ID (如 dept-rd)"
                        value={departmentId}
                        onChange={(event) => setDepartmentId(event.target.value)}
                      />
                      <Button loading={submitting} disabled={!departmentId.trim()} onClick={() => handleTrigger(() => triggerDepartmentOrgSync(departmentId.trim()))}>
                        执行
                      </Button>
                    </Space.Compact>
                  </Card>

                  <Card size="small" style={{ flex: 1, borderRadius: 12, border: "1px solid var(--admin-color-border)", boxShadow: "var(--admin-shadow-sm)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                      <div style={{ padding: 8, background: "var(--admin-color-bg)", borderRadius: 8 }}><UserPlus size={18} color="var(--admin-color-subtle)" /></div>
                      <div style={{ fontWeight: 500 }}>用户增量同步</div>
                    </div>
                    <Space.Compact style={{ width: "100%" }}>
                      <Input
                        placeholder="输入用户 External ID (如 ding-u1)"
                        value={userId}
                        onChange={(event) => setUserId(event.target.value)}
                      />
                      <Button loading={submitting} disabled={!userId.trim()} onClick={() => handleTrigger(() => triggerUserOrgSync(userId.trim()))}>
                        执行
                      </Button>
                    </Space.Compact>
                  </Card>
                </div>
              </div>
            </div>

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <Typography.Title level={5} style={{ fontSize: 15, margin: 0 }}>最近同步任务</Typography.Title>
                <Button type="text" icon={<RefreshCcw size={14} />} onClick={reload} loading={loading}>刷新列表</Button>
              </div>

              <div style={{ display: "flex", flexDirection: "column" }}>
                {jobs.map((job) => {
                  const diffState = diffStateByJobId[job.id];
                  const formattedDiffs = (diffState?.diffs ?? []).map(formatDiff);
                  const businessDiffs = formattedDiffs.filter((diff) => diff.changes.length > 0);
                  const groups = groupDiffs(businessDiffs);
                  const hiddenChangeSummary = summarizeHiddenChanges(formattedDiffs);
                  const visibleDiffCount = groups.reduce(
                    (count, group) => count + (diffState?.showAll ? group.diffs.length : Math.min(group.diffs.length, PREVIEW_DIFF_LIMIT)),
                    0
                  );
                  const collapsedBusinessDiffCount = businessDiffs.length - visibleDiffCount;

                  return (
                    <div key={job.id} className="admin-sync-job-item">
                      <div className="admin-sync-job-header">
                        <div className="admin-sync-job-title">
                          {job.status === "running" && <Spin size="small" />}
                          {formatScopeTitle(job.scopeType)}
                          <Tag color={getJobStatusTagColor(job.status)} style={{ borderRadius: 12, marginLeft: 8 }}>
                            {getJobStatusText(job.status)}
                          </Tag>
                        </div>
                        <div className="admin-sync-job-meta">
                          {formatLocalTime(job.updatedAt || job.finishedAt || job.createdAt)}
                        </div>
                      </div>

                      <div className="admin-sync-job-description">
                        {formatJobSummaryLine(job)}
                      </div>

                      <div className="admin-sync-job-chip-row">
                        {getSummaryChips(job).map((chip) => (
                          <span key={`${chip.label}:${chip.value}`} className={`admin-sync-job-chip ${chip.tone ?? "neutral"}`}>
                            <span>{chip.label}</span>
                            <strong>{chip.value}</strong>
                          </span>
                        ))}
                      </div>

                      <div className="admin-sync-job-meta-row">
                        <span>Task ID: <span className="admin-sync-job-code">{job.id}</span></span>
                        <span>Target: {formatScope(job)}</span>
                      </div>

                      <div className="admin-sync-job-actions">
                        <Button
                          size="small"
                          type="text"
                          icon={diffState?.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          onClick={() => toggleJobDiffs(job.id)}
                          aria-expanded={Boolean(diffState?.expanded)}
                        >
                          {diffState?.expanded ? "收起变化明细" : "查看变化明细"}
                        </Button>
                        {job.summary ? (
                          <details className="admin-sync-debug-json">
                            <summary>原始摘要</summary>
                            <pre>{formatJson(job.summary)}</pre>
                          </details>
                        ) : null}
                      </div>

                      {diffState?.expanded ? (
                        <div className="admin-sync-diff-panel">
                          {diffState.loading ? (
                            <div className="admin-sync-diff-loading"><Spin size="small" /> 正在加载变化明细</div>
                          ) : diffState.errorText ? (
                            <Alert type="error" showIcon message={diffState.errorText} />
                          ) : !diffState.diffs?.length ? (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本次同步没有具体变化" />
                          ) : (
                            <>
                              <div className="admin-sync-diff-panel-head">
                                <span><ListTree size={14} /> 业务变化</span>
                                <span>
                                  {businessDiffs.length} 项业务变化
                                  {hiddenChangeSummary.count > 0 ? `，已收起 ${hiddenChangeSummary.count} 项系统字段` : ""}
                                </span>
                              </div>
                              {hiddenChangeSummary.count > 0 ? (
                                <div className="admin-sync-diff-system-summary">
                                  <div className="admin-sync-diff-system-title">
                                    已收起系统字段变化
                                    <strong>{hiddenChangeSummary.count}</strong>
                                  </div>
                                  <div className="admin-sync-diff-system-reasons">
                                    {hiddenChangeSummary.reasons.map((item) => (
                                      <Tag key={item.label}>{item.label} {item.count}</Tag>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                              {groups.length > 0 ? (
                                groups.map((group) => {
                                  const visibleDiffs = diffState.showAll ? group.diffs : group.diffs.slice(0, PREVIEW_DIFF_LIMIT);
                                  return (
                                    <section key={group.key} className="admin-sync-diff-group">
                                      <div className="admin-sync-diff-group-title">
                                        <span>{group.label}</span>
                                        <Tag>{group.diffs.length}</Tag>
                                      </div>
                                      <div className="admin-sync-diff-list">
                                        {visibleDiffs.map((formatted) => (
                                          <article key={formatted.id} className="admin-sync-diff-row">
                                            <div className="admin-sync-diff-row-title">{formatted.title}</div>
                                            <div className="admin-sync-diff-row-meta">{formatted.meta}</div>
                                            <ul>
                                              {formatted.changes.map((change) => (
                                                <li key={change}>{change}</li>
                                              ))}
                                            </ul>
                                            {formatted.hiddenChanges.length > 0 ? (
                                              <div className="admin-sync-diff-row-system-note">
                                                另有 {formatted.hiddenChanges.length} 项系统字段已收起
                                              </div>
                                            ) : null}
                                          </article>
                                        ))}
                                      </div>
                                    </section>
                                  );
                                })
                              ) : (
                                <Empty
                                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                                  description={
                                    hiddenChangeSummary.count > 0
                                      ? "本次没有需要人工判断的业务变化"
                                      : "本次同步没有具体变化"
                                  }
                                />
                              )}
                              {collapsedBusinessDiffCount > 0 || diffState.showAll ? (
                                <Button size="small" type="link" onClick={() => toggleShowAllDiffs(job.id)}>
                                  {diffState.showAll ? "收起部分明细" : `显示全部，另有 ${collapsedBusinessDiffCount} 项业务变化`}
                                </Button>
                              ) : null}
                            </>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {jobs.length === 0 && <div style={{ textAlign: "center", color: "var(--admin-color-subtle)", padding: 24 }}>暂无同步任务记录</div>}
              </div>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
