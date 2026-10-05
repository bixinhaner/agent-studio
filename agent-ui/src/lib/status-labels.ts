const RESOURCE_STATUS_LABELS: Record<string, string> = {
  active: "已启用",
  enabled: "已启用",
  inactive: "已停用",
  disabled: "已停用",
  paused: "已暂停",
  archived: "已归档",
  draft: "草稿",
  pending: "待处理",
  error: "异常",
  failed: "失败",
  success: "成功",
  succeeded: "成功"
};

/** Admin-facing Chinese label for a lifecycle status code; unknown codes pass through. */
export function resourceStatusLabel(status: string | null | undefined): string {
  if (!status) return "未知";
  return RESOURCE_STATUS_LABELS[status] ?? status;
}
