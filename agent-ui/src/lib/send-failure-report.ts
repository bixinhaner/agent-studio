import { ApiError, apiBase, authHeaders } from "./api";

/**
 * Records a portal send that did not produce a saved user message, so the admin
 * conversation record shows why a conversation is empty. Best-effort; never throws.
 */

export type SendFailureStage =
  | "attachment_upload"
  | "attachment_not_ready"
  | "composer_send"
  | "run_blocked"
  | "thread_resolve"
  | "thread_create"
  | "message_save"
  | "session_start";

export type SendFailureAttachment = {
  name: string;
  status?: string;
  failureCode?: string;
  sizeBytes?: number;
};

export type SendFailureReport = {
  stage: SendFailureStage;
  threadId?: string | null;
  error?: unknown;
  errorCode?: string | null;
  messagePreview?: string | null;
  attachments?: SendFailureAttachment[];
  clientRunId?: string | null;
};

function clip(value: string | null | undefined, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function currentBuildId(): string | undefined {
  return typeof __AGENT_STUDIO_BUILD_ID__ === "string" ? __AGENT_STUDIO_BUILD_ID__ : undefined;
}

/**
 * The API handlers record their own failures (thread create, message save) and 409 is the
 * queued "still running" flow. The browser only reports what never reached a handler:
 * network errors, expired sessions, and proxy timeouts or gateway errors during deploys.
 */
export function shouldBrowserReportSendFailure(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.status === 0 || error.status === 401 || error.status === 408 || error.status >= 502;
}

export function buildSendFailureReportBody(report: SendFailureReport): Record<string, unknown> {
  const error = report.error;
  const apiError = error instanceof ApiError ? error : undefined;
  const detail = error instanceof Error
    ? [error.name && error.name !== "Error" ? error.name : "", apiError?.detail || error.message].filter(Boolean).join(": ")
    : typeof error === "string" ? error : undefined;
  return {
    stage: report.stage,
    thread_id: clip(report.threadId, 200),
    error_code: clip(report.errorCode ?? apiError?.code ?? apiError?.reasonCode, 120),
    http_status: apiError ? apiError.status : undefined,
    detail: clip(detail, 4000),
    message_preview: clip(report.messagePreview, 1000),
    attachments: (report.attachments ?? []).slice(0, 20).map((item) => ({
      name: item.name.slice(0, 300),
      ...(item.status ? { status: item.status.slice(0, 40) } : {}),
      ...(item.failureCode ? { failure_code: item.failureCode.slice(0, 80) } : {}),
      ...(typeof item.sizeBytes === "number" ? { size_bytes: item.sizeBytes } : {})
    })),
    client_run_id: clip(report.clientRunId, 200),
    build_id: currentBuildId()
  };
}

export function reportSendFailure(report: SendFailureReport): void {
  try {
    if (typeof fetch !== "function") return;
    void fetch(`${apiBase()}/api/send-failures`, {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(buildSendFailureReportBody(report))
    }).catch(() => undefined);
  } catch {
    // Reporting must never affect sending.
  }
}
