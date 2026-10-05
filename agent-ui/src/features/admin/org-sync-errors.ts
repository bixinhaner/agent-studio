import type { OrgSyncJob } from "./types";

export type SyncFailureExplanation = {
  /** Plain-language cause for admins. */
  reason: string;
  /** What the admin can do about it. */
  action: string;
  /** Original upstream message, kept for troubleshooting. */
  raw: string;
};

function jobDetail(job: OrgSyncJob): string | undefined {
  const summary = job.summary && typeof job.summary === "object" && !Array.isArray(job.summary) ? (job.summary as Record<string, unknown>) : undefined;
  const detail = summary?.detail ?? summary?.message;
  return typeof detail === "string" && detail.trim() ? detail.trim() : undefined;
}

/** Translates raw DingTalk / network errors from org sync into an admin-readable cause and next step. */
export function explainSyncFailure(raw: string): SyncFailureExplanation {
  if (/subcode=900(02|18)|最大qps|次数过多|\b429\b/i.test(raw)) {
    return {
      reason: "钉钉接口限流：整点前后企业内所有钉钉应用调用量过大，本轮请求被临时限制。",
      action: "系统会自动退避重试；仍失败时稍后手动同步即可，无需修改配置。",
      raw
    };
  }
  if (/40014|access[_\s-]*token|不合法的access_token/i.test(raw)) {
    return { reason: "钉钉凭证失效或已被重置。", action: "到集成中心检查钉钉 AppKey / AppSecret 后重新同步。", raw };
  }
  if (/60011|60020|no permission|权限|forbidden|\b403\b/i.test(raw)) {
    return { reason: "钉钉应用缺少通讯录读取权限或 IP 白名单未放行。", action: "在钉钉开放平台为应用开通通讯录权限并检查服务器出口 IP 白名单。", raw };
  }
  if (/timeout|timed out|ETIMEDOUT|ECONNRESET|fetch failed|ENOTFOUND|network/i.test(raw)) {
    return { reason: "连接钉钉超时或网络中断。", action: "稍后重试；持续失败请检查服务器网络。", raw };
  }
  return { reason: raw, action: "可展开任务查看详情，或稍后手动重新同步。", raw };
}

export function jobFailureExplanation(job: OrgSyncJob | undefined): SyncFailureExplanation | undefined {
  if (!job || job.status !== "failed") return undefined;
  return explainSyncFailure(jobDetail(job) ?? "同步任务异常结束，未返回原因。");
}

/** The most recent finished job decides whether org sync needs attention. */
export function latestFinishedJob(jobs: OrgSyncJob[]): OrgSyncJob | undefined {
  return jobs.find((job) => job.status !== "running" && job.status !== "pending");
}
