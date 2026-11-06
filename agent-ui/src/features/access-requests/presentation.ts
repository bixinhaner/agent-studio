import { formatAdminDate, formatAdminDateTime } from "../../lib/formatters";
export function formatLocalTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatAdminDateTime(date);
}

export function formatLocalDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatAdminDate(date);
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (!Number.isFinite(bytes) || !bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function requestStatusLabel(status: string): string {
  switch (status) {
    case "submitted":
      return "已提交";
    case "under_review":
      return "审核中";
    case "needs_info":
      return "待补资料";
    case "review_conflict":
      return "待裁决";
    case "approved_pending_provision":
      return "待开通";
    case "provisioned":
      return "已开通";
    case "invited":
      return "已发邀请";
    case "activated":
      return "已激活";
    case "rejected":
      return "已拒绝";
    case "closed":
      return "已关闭";
    default:
      return status || "未知";
  }
}

export function requestStatusTone(status: string): "default" | "processing" | "success" | "warning" | "error" {
  switch (status) {
    case "submitted":
    case "under_review":
      return "processing";
    case "needs_info":
    case "review_conflict":
      return "warning";
    case "approved_pending_provision":
    case "provisioned":
    case "invited":
    case "activated":
      return "success";
    case "rejected":
      return "error";
    default:
      return "default";
  }
}

export function reviewModeLabel(mode: string): string {
  switch (mode) {
    case "all_to_approve":
      return "全部 To 通过";
    case "minimum_approvals":
      return "最少通过数";
    default:
      return "任一 To 通过";
  }
}

export function rejectionModeLabel(mode: string): string {
  switch (mode) {
    case "manual_on_conflict":
      return "冲突转管理员";
    default:
      return "任一 To 拒绝";
  }
}

export function reviewerDecisionLabel(decision: string): string {
  switch (decision) {
    case "approved":
      return "已通过";
    case "rejected":
      return "已拒绝";
    case "needs_info":
      return "待补资料";
    default:
      return "待处理";
  }
}

export function reviewerDecisionTone(decision: string): "default" | "success" | "warning" | "error" {
  switch (decision) {
    case "approved":
      return "success";
    case "rejected":
      return "error";
    case "needs_info":
      return "warning";
    default:
      return "default";
  }
}

export function deliveryTypeLabel(value: string): string {
  return value === "cc" ? "Cc" : "To";
}

export function membershipTypeLabel(value: string | null | undefined): string {
  return value === "customer_member" ? "User" : "Admin";
}

/** Reviewer search matches name or email by substring, case-insensitively; an empty query lists everyone. */
export function reviewerCandidateMatches(
  query: string,
  candidate: { email: string; displayName: string } | undefined
): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  if (!candidate) return false;
  return candidate.email.toLowerCase().includes(normalized) || candidate.displayName.toLowerCase().includes(normalized);
}

/** Internal reviewers fit every request; brand employees only fit requests from their own brand. */
export function reviewerCandidatesForBrand<T extends { publicBrandId?: string }>(
  candidates: readonly T[],
  publicBrandId: string | null | undefined
): T[] {
  return candidates.filter((candidate) => !candidate.publicBrandId || candidate.publicBrandId === publicBrandId);
}

export const ACCESS_REQUEST_STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "all", label: "全部状态" },
  ...[
    "submitted",
    "under_review",
    "needs_info",
    "review_conflict",
    "approved_pending_provision",
    "provisioned",
    "invited",
    "activated",
    "rejected",
    "closed"
  ].map((value) => ({ value, label: requestStatusLabel(value) }))
];

const OPEN_REQUEST_STATUSES = new Set(["submitted", "under_review", "needs_info", "review_conflict", "approved_pending_provision"]);
const REVIEWABLE_REQUEST_STATUSES = new Set(["submitted", "under_review", "needs_info", "review_conflict"]);

export type AccessRequestActionAvailability = {
  /** Why "request info" / "reject" are unavailable; empty when they are allowed. */
  closeBlockedReason: string;
  /** Why sending review mail is unavailable; empty when it is allowed. */
  sendReviewBlockedReason: string;
  /** Shown as a confirmation before provisioning anything that has not been approved yet; empty when approved. */
  provisionWarning: string;
};

/** The server accepts these actions in any status, so the console guards against the ones that would surprise the applicant. */
export function accessRequestActionAvailability(status: string): AccessRequestActionAvailability {
  const closed = !OPEN_REQUEST_STATUSES.has(status);
  return {
    closeBlockedReason: closed ? `申请已${requestStatusLabel(status)}，不能再要求补资料或拒绝` : "",
    sendReviewBlockedReason: REVIEWABLE_REQUEST_STATUSES.has(status) ? "" : `申请已${requestStatusLabel(status)}，无需再发送审核`,
    provisionWarning:
      status === "approved_pending_provision"
        ? ""
        : status === "rejected"
          ? "这条申请已被拒绝。确定仍要开通套餐并给申请人发送邀请吗？"
          : ["provisioned", "invited", "activated"].includes(status)
            ? `这条申请已${requestStatusLabel(status)}。再次开通会覆盖目标组织的套餐并重新发送邀请，确定继续吗？`
            : "这条申请还没有审核通过。确定跳过审核，直接开通套餐并发送邀请吗？"
  };
}

/** Returns the first problem with the reviewer rows, or an empty string when they can be saved. */
export function reviewerRowsProblem(rows: Array<{ reviewerEmail: string; deliveryType: string }>, options: { requireTo: boolean }): string {
  const seen = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const email = row.reviewerEmail.trim().toLowerCase();
    if (!email) return `第 ${index + 1} 行审核人邮箱为空`;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return `第 ${index + 1} 行不是有效邮箱：${row.reviewerEmail.trim()}`;
    if (seen.has(email)) return `审核人重复：${email}`;
    seen.add(email);
  }
  if (options.requireTo && !rows.some((row) => row.deliveryType === "to")) return "至少需要一位 To 审核人";
  return "";
}

export type AccessRequestHashState = { requestId: string; status: string; query: string };

/** Admin sections live in the hash (`#admin/access-requests?request=…&status=…&q=…`), so view state is kept there too. */
export function readAccessRequestHashState(hash: string): AccessRequestHashState {
  const params = new URLSearchParams(hash.split("?")[1] ?? "");
  const status = params.get("status")?.trim() ?? "";
  return {
    requestId: params.get("request")?.trim() ?? "",
    status: ACCESS_REQUEST_STATUS_FILTERS.some((item) => item.value === status) ? status : "all",
    query: params.get("q") ?? ""
  };
}

export function buildAccessRequestHash(hash: string, state: AccessRequestHashState): string {
  const base = hash.split("?")[0] || "#admin/access-requests";
  const params = new URLSearchParams();
  if (state.requestId) params.set("request", state.requestId);
  if (state.status && state.status !== "all") params.set("status", state.status);
  if (state.query.trim()) params.set("q", state.query);
  const search = params.toString();
  return search ? `${base}?${search}` : base;
}
