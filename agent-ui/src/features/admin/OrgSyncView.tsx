import { useEffect, useState } from "react";
import { Alert, Button, Card, Drawer, Empty, Input, Segmented, Space, Spin, Tag, Tooltip, Typography } from "antd";
import { Building, ChevronDown, ChevronRight, ListTree, MoreHorizontal, RefreshCcw, UserPlus, Zap } from "lucide-react";

import {
  fetchOrgSyncConfig,
  fetchOrgSyncJobDiffs,
  fetchOrgSyncJobs,
  triggerDepartmentOrgSync,
  triggerFullOrgSync,
  triggerUserOrgSync
} from "./api";
import type {
  OrgSyncConfig,
  OrgSyncDepartmentLookupEntry,
  OrgSyncDiff,
  OrgSyncJob,
  OrgSyncUserLookupEntry
} from "./types";

type JobDiffState = {
  expanded: boolean;
  loading: boolean;
  showAll: boolean;
  errorText?: string;
  diffs?: OrgSyncDiff[];
  departmentLookup?: Record<string, OrgSyncDepartmentLookupEntry>;
  userLookup?: Record<string, OrgSyncUserLookupEntry>;
  entityFilter?: string;
  query?: string;
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
  changeType: string;
  changeLabel: string;
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
  status: "账号状态",
  statusSource: "状态来源",
  syncState: "钉钉状态",
  manualDisabled: "手动禁用",
  departmentExternalIds: "所属部门",
  primaryDepartmentExternalId: "主部门",
  title: "岗位",
  jobNumber: "工号",
  workPlace: "工作地点",
  isAdmin: "钉钉管理员",
  isBoss: "主管",
  isLeader: "部门负责人",
  lifecycleState: "在职状态"
};

const DEPARTMENT_FIELD_LABELS: Record<string, string> = {
  name: "部门名称",
  parentExternalId: "上级部门",
  sortOrder: "排序",
  status: "状态"
};

const USER_VISIBLE_FIELDS = [
  "displayName",
  "email",
  "title",
  "jobNumber",
  "workPlace",
  "status",
  "syncState",
  "statusSource",
  "manualDisabled",
  "departmentExternalIds",
  "primaryDepartmentExternalId",
  "isAdmin",
  "isBoss",
  "isLeader",
  "lifecycleState"
];

const DEPARTMENT_VISIBLE_FIELDS = ["name", "parentExternalId", "sortOrder", "status"];
const USER_SYSTEM_FIELDS = new Set(["userId", "openId", "corpId", "unionId", "managerDingTalkUserId"]);
const PREVIEW_DIFF_LIMIT = 6;

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
  const reconciliation = asRecord(summary.reconciliation);
  const reconciliationBlocked = reconciliation?.enabled === true && reconciliation.safe === false;
  const total = asNumber(summary.total);
  if (!total) {
    return reconciliationBlocked
      ? "通讯录已更新；完整性校验未通过，本轮没有自动停用缺失员工或部门。"
      : "未发现通讯录变化。";
  }

  const entityParts = [
    ["department", "部门"],
    ["user", "员工"],
    ["membership", "部门关系"]
  ]
    .map(([key, label]) => ({ label, count: asNumber(summary[key]) ?? 0 }))
    .filter((item) => item.count > 0)
    .map((item) => `${item.label} ${item.count}`);

  const changeText = `发现 ${total} 项变化：${entityParts.join("、") || formatChangeBreakdown(summary)}。`;
  return reconciliationBlocked
    ? `${changeText} 完整性校验未通过，本轮没有自动停用缺失员工或部门。`
    : changeText;
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

function formatDepartmentReference(
  value: unknown,
  departmentLookup: Record<string, OrgSyncDepartmentLookupEntry> | undefined
): string {
  const externalId = typeof value === "number" && Number.isFinite(value) ? String(value) : asString(value);
  if (!externalId) return formatValue(value);
  if (externalId === "1") return "根部门";
  const department = departmentLookup?.[externalId];
  if (!department) return "未知部门";
  return department.path || department.name || "未命名部门";
}

function formatUserReference(
  value: unknown,
  userLookup: Record<string, OrgSyncUserLookupEntry> | undefined
): string {
  const key = typeof value === "number" && Number.isFinite(value) ? String(value) : asString(value);
  if (!key) return formatValue(value);
  const user = userLookup?.[key];
  if (!user) return "未知员工";
  const label = user.displayName || user.email || "未命名员工";
  const detail = user.email && user.email !== label ? user.email : undefined;
  return detail ? `${label}（${detail}）` : label;
}

function formatUserMeta(
  value: unknown,
  userLookup: Record<string, OrgSyncUserLookupEntry> | undefined
): string {
  const key = typeof value === "number" && Number.isFinite(value) ? String(value) : asString(value);
  if (!key) return "未匹配员工资料";
  const user = userLookup?.[key];
  if (!user) return "未匹配员工资料";
  return user.displayName || user.email ? "已匹配员工资料" : "员工资料待补全";
}

function isDepartmentField(entityType: string, field: string): boolean {
  return (
    (entityType === "department" && field === "parentExternalId") ||
    field === "departmentExternalIds" ||
    field === "primaryDepartmentExternalId"
  );
}

function formatFieldValue(
  entityType: string,
  field: string,
  value: unknown,
  departmentLookup: Record<string, OrgSyncDepartmentLookupEntry> | undefined
): string {
  if (!isDepartmentField(entityType, field)) return formatValue(value);
  if (Array.isArray(value)) {
    if (!value.length) return "空";
    return value.map((item) => formatDepartmentReference(item, departmentLookup)).join("、");
  }
  return formatDepartmentReference(value, departmentLookup);
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
  entityType: string,
  departmentLookup: Record<string, OrgSyncDepartmentLookupEntry> | undefined
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
        pushRow(`${labels[field] ?? field}：${formatFieldValue(entityType, field, afterValue, departmentLookup)}`);
      }
      continue;
    }
    if (changeType === "removed") {
      if (beforeValue !== undefined && beforeValue !== null && beforeValue !== "") {
        pushRow(`${labels[field] ?? field}：${formatFieldValue(entityType, field, beforeValue, departmentLookup)}`);
      }
      continue;
    }
    if (!sameValue(beforeValue, afterValue)) {
      pushRow(
        `${labels[field] ?? field}：${formatFieldValue(entityType, field, beforeValue, departmentLookup)} → ${formatFieldValue(
          entityType,
          field,
          afterValue,
          departmentLookup
        )}`
      );
    }
  }
  return rows;
}

function formatMembershipSet(
  payload: Record<string, unknown> | undefined,
  departmentLookup: Record<string, OrgSyncDepartmentLookupEntry> | undefined
): string {
  const memberships = asArray(payload?.memberships)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      departmentId: asString(item.departmentId) ?? "未知部门",
      isPrimary: item.isPrimary === true
    }));

  if (memberships.length) {
    return memberships
      .map((item) => `${item.isPrimary ? "主部门" : "部门"} ${formatDepartmentReference(item.departmentId, departmentLookup)}`)
      .join("、");
  }

  const departmentIds = asArray(payload?.departmentExternalIds).map((departmentId) =>
    formatDepartmentReference(departmentId, departmentLookup)
  );
  const primaryDepartmentId = asString(payload?.primaryDepartmentExternalId);
  if (departmentIds.length || primaryDepartmentId) {
    return [
      primaryDepartmentId ? `主部门 ${formatDepartmentReference(primaryDepartmentId, departmentLookup)}` : undefined,
      departmentIds.length ? `部门 ${departmentIds.join("、")}` : undefined
    ].filter(Boolean).join("、");
  }

  return "未设置部门";
}

function formatMembershipChanges(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
  changeType: string,
  departmentLookup: Record<string, OrgSyncDepartmentLookupEntry> | undefined
): string[] {
  if (changeType === "created") return [`加入：${formatMembershipSet(after, departmentLookup)}`];
  if (changeType === "removed") return [`移除：${formatMembershipSet(before, departmentLookup)}`];
  return [`从 ${formatMembershipSet(before, departmentLookup)} 调整为 ${formatMembershipSet(after, departmentLookup)}`];
}

function resolveDiffTarget(
  diff: OrgSyncDiff,
  userLookup: Record<string, OrgSyncUserLookupEntry> | undefined
): string {
  const before = asRecord(diff.beforePayload);
  const after = asRecord(diff.afterPayload);
  if (diff.entityType === "department") {
    return asString(after?.name) ?? asString(before?.name) ?? "未知部门";
  }
  if (diff.entityType === "membership") {
    return formatUserReference(
      asString(after?.userId) ?? asString(before?.userId) ?? asString(diff.entityExternalId),
      userLookup
    );
  }
  return (
    asString(after?.displayName) ??
    asString(before?.displayName) ??
    asString(after?.email) ??
    asString(before?.email) ??
    "未知员工"
  );
}

function formatDiff(
  diff: OrgSyncDiff,
  departmentLookup: Record<string, OrgSyncDepartmentLookupEntry> | undefined,
  userLookup: Record<string, OrgSyncUserLookupEntry> | undefined
): FormattedDiff {
  const before = asRecord(diff.beforePayload);
  const after = asRecord(diff.afterPayload);
  const entityLabel = ENTITY_LABELS[diff.entityType] ?? diff.entityType;
  const changeLabel = CHANGE_LABELS[diff.changeType] ?? diff.changeType;
  const target = resolveDiffTarget(diff, userLookup);
  const idText = diff.entityType === "membership"
    ? formatUserMeta(asString(after?.userId) ?? asString(before?.userId) ?? asString(diff.entityExternalId), userLookup)
    : "来自组织同步";

  let rows: FieldChangeRows;
  if (diff.entityType === "membership") {
    rows = { visible: formatMembershipChanges(before, after, diff.changeType, departmentLookup), hidden: [] };
  } else if (diff.entityType === "department") {
    rows = fieldChanges(
      before,
      after,
      DEPARTMENT_VISIBLE_FIELDS,
      DEPARTMENT_FIELD_LABELS,
      diff.changeType,
      diff.entityType,
      departmentLookup
    );
  } else {
    rows = fieldChanges(
      before,
      after,
      USER_VISIBLE_FIELDS,
      USER_FIELD_LABELS,
      diff.changeType,
      diff.entityType,
      departmentLookup
    );
  }

  if (!rows.visible.length && !rows.hidden.length) {
    rows.visible = ["仅同步元数据发生变化。"];
  }

  return {
    id: diff.id,
    entityType: diff.entityType,
    changeType: diff.changeType,
    changeLabel,
    title: `${entityLabel} · ${target}`,
    meta: idText,
    changes: rows.visible,
    hiddenChanges: rows.hidden
  };
}

function groupDiffs(diffs: FormattedDiff[]) {
  const order = ["created", "updated", "relationship", "removed", "other"];
  const groups = new Map<string, FormattedDiff[]>();
  for (const diff of diffs) {
    const key = diff.changeType === "created" || diff.changeType === "restored"
      ? "created"
      : diff.entityType === "membership" || diff.changeType === "primary_changed"
        ? "relationship"
        : diff.changeType === "updated"
          ? "updated"
          : diff.changeType === "disabled" || diff.changeType === "removed"
            ? "removed"
            : "other";
    groups.set(key, [...(groups.get(key) ?? []), diff]);
  }
  const labels: Record<string, string> = {
    created: "新增",
    updated: "更新",
    relationship: "关系调整",
    removed: "停用与移除",
    other: "其他变化"
  };
  return order
    .map((key) => ({ key, label: labels[key], diffs: groups.get(key) ?? [] }))
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
  const [operationsOpen, setOperationsOpen] = useState(false);
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
        departmentLookup: state[jobId]?.departmentLookup,
        userLookup: state[jobId]?.userLookup,
        entityFilter: state[jobId]?.entityFilter,
        query: state[jobId]?.query,
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
          departmentLookup: response.departmentLookup,
          userLookup: response.userLookup,
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

  function updateDiffView(jobId: string, patch: Pick<JobDiffState, "entityFilter" | "query">) {
    setDiffStateByJobId((state) => {
      const current = state[jobId];
      if (!current) return state;
      return {
        ...state,
        [jobId]: {
          ...current,
          ...patch,
          showAll: false
        }
      };
    });
  }

  const latestJob = jobs[0];
  const isRunning = latestJob?.status === "running";

  return (
    <>
      <Card className="admin-tree-card admin-sync-panel antd-admin-card" bordered={false} bodyStyle={{ padding: 0 }}>
        <div className="admin-tree-header admin-sync-panel-header">
          <Typography.Title level={4}>最近同步任务</Typography.Title>
          <div className="admin-sync-panel-actions">
            <Tooltip title="同步设置与手动执行">
              <Button aria-label="同步设置与手动执行" icon={<MoreHorizontal size={16} />} onClick={() => setOperationsOpen(true)} />
            </Tooltip>
            <Tooltip title="刷新任务">
              <Button aria-label="刷新任务" icon={<RefreshCcw size={15} />} onClick={() => void reload()} loading={loading} />
            </Tooltip>
          </div>
        </div>

        {errorText ? <Alert type="error" showIcon message={errorText} className="admin-sync-alert" /> : null}
        {loading ? <div className="admin-sync-panel-loading"><Spin size="large" /></div> : null}

        {!loading ? (
          <div className="admin-sync-job-table">
            <div className="admin-sync-job-table-head" aria-hidden="true">
              <span />
              <span>开始时间</span>
              <span>状态</span>
              <span>触发方式</span>
              <span>耗时</span>
              <span>摘要</span>
            </div>
            <div className="admin-sync-job-table-body">
              {jobs.map((job) => {
                  const diffState = diffStateByJobId[job.id];
                  const formattedDiffs = (diffState?.diffs ?? []).map((diff) =>
                    formatDiff(diff, diffState?.departmentLookup, diffState?.userLookup)
                  );
                  const businessDiffs = formattedDiffs.filter((diff) => diff.changes.length > 0);
                  const entityFilter = diffState?.entityFilter ?? "all";
                  const diffQuery = diffState?.query?.trim().toLowerCase() ?? "";
                  const filteredBusinessDiffs = businessDiffs.filter((diff) => {
                    if (entityFilter !== "all" && diff.entityType !== entityFilter) return false;
                    if (!diffQuery) return true;
                    return [diff.title, diff.changeLabel, ...diff.changes].join(" ").toLowerCase().includes(diffQuery);
                  });
                  const groups = groupDiffs(filteredBusinessDiffs);
                  const hiddenChangeSummary = summarizeHiddenChanges(formattedDiffs);
                  const visibleDiffCount = groups.reduce(
                    (count, group) => count + (diffState?.showAll ? group.diffs.length : Math.min(group.diffs.length, PREVIEW_DIFF_LIMIT)),
                    0
                  );
                  const collapsedBusinessDiffCount = filteredBusinessDiffs.length - visibleDiffCount;

                  return (
                    <div key={job.id} className={`admin-sync-job-record${diffState?.expanded ? " expanded" : ""}`}>
                      <button className="admin-sync-job-row" type="button" onClick={() => void toggleJobDiffs(job.id)} aria-expanded={Boolean(diffState?.expanded)}>
                        <span className="admin-sync-job-chevron">
                          {diffState?.expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </span>
                        <span>{formatLocalTime(job.startedAt || job.createdAt)}</span>
                        <span className="admin-sync-job-status">
                          {job.status === "running" ? <Spin size="small" /> : <i className={`admin-sync-status-dot ${isSucceededStatus(job.status) ? "success" : job.status}`} />}
                          {getJobStatusText(job.status)}
                        </span>
                        <span>{formatTriggerType(job.triggerType)}</span>
                        <span>{formatDuration(job)}</span>
                        <span className="admin-sync-job-row-summary">{formatJobSummaryLine(job)}</span>
                      </button>

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
                                <span><ListTree size={14} /> 变化明细</span>
                                <span>
                                  {businessDiffs.length} 项业务变化
                                  {hiddenChangeSummary.count > 0 ? `，已收起 ${hiddenChangeSummary.count} 项系统字段` : ""}
                                </span>
                              </div>
                              <div className="admin-sync-diff-toolbar">
                                <Segmented
                                  size="small"
                                  value={entityFilter}
                                  options={[
                                    { label: "全部", value: "all" },
                                    { label: "员工", value: "user" },
                                    { label: "部门", value: "department" },
                                    { label: "部门关系", value: "membership" }
                                  ]}
                                  onChange={(value) => updateDiffView(job.id, { entityFilter: String(value) })}
                                />
                                <Input
                                  size="small"
                                  allowClear
                                  aria-label="搜索变化内容"
                                  placeholder="搜索姓名、部门或变化内容"
                                  value={diffState.query ?? ""}
                                  onChange={(event) => updateDiffView(job.id, { query: event.target.value })}
                                />
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
                                    <section key={group.key} className={`admin-sync-diff-group ${group.key}`}>
                                      <div className="admin-sync-diff-group-title">
                                        <span>{group.label}</span>
                                        <strong>({group.diffs.length})</strong>
                                      </div>
                                      <div className="admin-sync-diff-table">
                                        <div className="admin-sync-diff-table-head" aria-hidden="true">
                                          <span>类型</span>
                                          <span>名称</span>
                                          <span>变更内容</span>
                                        </div>
                                        {visibleDiffs.map((formatted) => (
                                          <article key={formatted.id} className="admin-sync-diff-row">
                                            <span className={`admin-sync-change-type ${formatted.changeType}`}>{formatted.changeLabel}</span>
                                            <div className="admin-sync-diff-row-title">
                                              <span>{formatted.title}</span>
                                              <small>{formatted.meta}</small>
                                            </div>
                                            <ul className="admin-sync-diff-row-changes">
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
                                      ? "当前筛选下没有需要人工判断的业务变化"
                                      : "当前筛选下没有具体变化"
                                  }
                                />
                              )}
                              {collapsedBusinessDiffCount > 0 || diffState.showAll ? (
                                <Button size="small" type="link" onClick={() => toggleShowAllDiffs(job.id)}>
                                  {diffState.showAll ? "收起部分明细" : `显示全部，另有 ${collapsedBusinessDiffCount} 项业务变化`}
                                </Button>
                              ) : null}
                              {job.summary ? (
                                <details className="admin-sync-debug-json">
                                  <summary><ChevronRight size={14} /> 诊断信息 <span>展开查看原始数据</span></summary>
                                  <pre>{formatJson(job.summary)}</pre>
                                </details>
                              ) : null}
                            </>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              {jobs.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无同步任务记录" /> : null}
            </div>
          </div>
        ) : null}
      </Card>

      <Drawer
        title="同步设置与手动执行"
        width={440}
        open={operationsOpen}
        onClose={() => setOperationsOpen(false)}
      >
        {config ? (
          <div className="admin-sync-operations">
            <div className="admin-sync-policy-summary">
              <div>
                <span>自动化策略</span>
                <strong>{config.enabled ? formatCadence(config.intervalMinutes) : "已关闭"}</strong>
              </div>
              <Tag color={config.enabled ? "success" : "default"}>{config.enabled ? "已启用" : "已关闭"}</Tag>
            </div>
            <section className="admin-sync-operation-block">
              <div className="admin-sync-operation-title"><Zap size={17} /> 全量同步</div>
              <p>立即同步全部员工、部门和部门关系。</p>
              <Button type="primary" block loading={submitting || isRunning} onClick={() => handleTrigger(triggerFullOrgSync)}>立即执行</Button>
            </section>
            <section className="admin-sync-operation-block">
              <div className="admin-sync-operation-title"><Building size={17} /> 部门增量同步</div>
              <p>只同步指定钉钉部门及相关组织信息。</p>
              <Space.Compact block>
                <Input placeholder="钉钉部门编号" value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} />
                <Button loading={submitting} disabled={!departmentId.trim()} onClick={() => handleTrigger(() => triggerDepartmentOrgSync(departmentId.trim()))}>执行</Button>
              </Space.Compact>
            </section>
            <section className="admin-sync-operation-block">
              <div className="admin-sync-operation-title"><UserPlus size={17} /> 员工增量同步</div>
              <p>只同步指定员工账号及其部门关系。</p>
              <Space.Compact block>
                <Input placeholder="钉钉员工账号" value={userId} onChange={(event) => setUserId(event.target.value)} />
                <Button loading={submitting} disabled={!userId.trim()} onClick={() => handleTrigger(() => triggerUserOrgSync(userId.trim()))}>执行</Button>
              </Space.Compact>
            </section>
          </div>
        ) : <Spin />}
      </Drawer>
    </>
  );
}
