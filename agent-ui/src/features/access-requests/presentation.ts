export function formatLocalTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function formatLocalDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
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
