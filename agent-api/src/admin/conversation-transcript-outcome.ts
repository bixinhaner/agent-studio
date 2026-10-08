/**
 * Why an assistant turn did not complete, as recorded on the persisted message.
 * The portal shows users a friendly notice; administrators additionally need the
 * concrete cause (code, raw runtime detail, whether auto-recovery already ran)
 * without digging through server logs.
 */
export type TranscriptTurnOutcomeKind =
  | "user_stopped"
  | "auto_closed"
  | "system_update"
  | "deployment_drain"
  | "ai_service_busy"
  | "auto_recovery_exhausted"
  | "runtime_error"
  | "unknown";

export type TranscriptTurnOutcome = {
  kind: TranscriptTurnOutcomeKind;
  /** Short admin-facing label, e.g. "用户停止". */
  label: string;
  /** One-line explanation of what happened and what the user saw. */
  reason: string;
  code: string | null;
  reasonCode: string | null;
  /** Raw runtime/server detail captured at failure time. */
  rawDetail: string | null;
  autoRecoveryAttempted: boolean;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function auditPart(message: UnknownRecord): UnknownRecord | null {
  const parts = Array.isArray(message.content) ? message.content : [];
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = asRecord(parts[index]);
    if (part?.type === "data" && part.name === "codex_process_audit") return asRecord(part.data);
  }
  return null;
}

const OUTCOMES: Record<TranscriptTurnOutcomeKind, { label: string; reason: string }> = {
  user_stopped: {
    label: "用户停止",
    reason: "用户停止了这一轮，已生成的内容保留在回复中（2026-10-08 之前，运行中发送新消息也会触发停止）。"
  },
  auto_closed: { label: "自动收尾", reason: "上一轮没有正常结束，用户继续对话时系统自动关闭了这一轮。" },
  system_update: { label: "系统更新中断", reason: "服务更新时这一轮仍在运行，被中断；用户侧提示可重新发送。" },
  deployment_drain: { label: "部署切换拒绝", reason: "请求到达时服务正在部署切换，未开始运行；用户侧提示稍后重试。" },
  ai_service_busy: { label: "AI 服务繁忙", reason: "上游 AI 服务繁忙或限流，本轮失败；用户侧提示稍后重试。" },
  auto_recovery_exhausted: { label: "自动恢复失败", reason: "运行中断后系统已自动重试一次仍失败；用户侧显示“重新运行”。" },
  runtime_error: { label: "运行失败", reason: "运行时返回错误，用户侧显示了通用失败提示。" },
  unknown: { label: "未完成", reason: "回复未完整结束，可能是连接断开或运行中途停止。" }
};

function outcome(
  kind: TranscriptTurnOutcomeKind,
  details: Partial<Omit<TranscriptTurnOutcome, "kind" | "label" | "reason">> = {}
): TranscriptTurnOutcome {
  return {
    kind,
    ...OUTCOMES[kind],
    code: details.code ?? null,
    reasonCode: details.reasonCode ?? null,
    rawDetail: details.rawDetail ?? null,
    autoRecoveryAttempted: details.autoRecoveryAttempted ?? false
  };
}

/** Returns null for completed (or still running) assistant messages. */
export function extractTranscriptTurnOutcome(message: unknown): TranscriptTurnOutcome | null {
  const row = asRecord(message);
  if (!row) return null;
  const status = asRecord(row.status);
  const statusType = text(status?.type)?.toLowerCase();
  const statusReason = text(status?.reason)?.toLowerCase();
  const custom = asRecord(asRecord(row.metadata)?.custom);
  const stopped = custom?.stopped === true || asRecord(row.metadata)?.stopped === true;
  const failed = statusType === "error" || statusReason === "error";
  const cancelled = statusType === "incomplete" && (statusReason === "cancelled" || statusReason === "aborted" || statusReason === "abort");
  if (!failed && !stopped && !cancelled && statusType !== "incomplete") return null;

  const audit = auditPart(row);
  const code = text(audit?.code);
  const reasonCode = text(audit?.reasonCode);
  const rawDetail = text(audit?.rawDetail) ?? text(status?.error);
  const autoRecoveryAttempted = custom?.autoRecoveryAttempted === true || text(status?.error) === "portal_auto_recovery_exhausted";
  const details = { code, reasonCode, rawDetail, autoRecoveryAttempted };

  if (!failed && (stopped || cancelled)) {
    const stopReason = text(custom?.stopReason) ?? text(audit?.reason);
    return outcome(stopReason === "dangling_user_head" ? "auto_closed" : "user_stopped", {
      ...details,
      rawDetail: stopReason
    });
  }
  if (!failed) return outcome("unknown", details);

  const upperCode = (code ?? "").toUpperCase();
  if (autoRecoveryAttempted) return outcome("auto_recovery_exhausted", details);
  if (upperCode === "SYSTEM_UPDATE_INTERRUPTED" || reasonCode === "system_update") return outcome("system_update", details);
  if (upperCode === "DEPLOYMENT_DRAIN" || reasonCode === "deployment_drain") return outcome("deployment_drain", details);
  if (upperCode === "AI_SERVICE_BUSY" || reasonCode === "ai_service_busy") return outcome("ai_service_busy", details);
  return outcome("runtime_error", details);
}
