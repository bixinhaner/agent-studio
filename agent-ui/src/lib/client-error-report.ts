import { apiBase, authHeaders } from "./api";

export type ClientErrorReport = {
  source: string;
  error: unknown;
  componentStack?: string | null;
  threadId?: string | null;
  locale?: string | null;
  context?: Record<string, unknown>;
};

const MAX_TEXT = 4000;

function clip(value: string | null | undefined, max = MAX_TEXT): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function currentBuildId(): string | undefined {
  return typeof __AGENT_STUDIO_BUILD_ID__ === "string" ? __AGENT_STUDIO_BUILD_ID__ : undefined;
}

export function buildClientErrorReportBody(report: ClientErrorReport): Record<string, unknown> {
  const error = report.error instanceof Error ? report.error : undefined;
  const message = error ? error.message : String(report.error ?? "Unknown error");
  return {
    source: report.source,
    name: clip(error?.name, 200),
    message: clip(message) ?? "Unknown error",
    stack: clip(error?.stack, MAX_TEXT * 2),
    component_stack: clip(report.componentStack, MAX_TEXT * 2),
    thread_id: clip(report.threadId, 200),
    build_id: currentBuildId(),
    locale: clip(report.locale, 20),
    // Path only: query strings can carry thread, folder and file identifiers.
    url_path: typeof window !== "undefined" ? clip(window.location.pathname, 500) : undefined,
    context: report.context
  };
}

/** Best-effort report of a browser render failure to the service log; never throws. */
export function reportClientError(report: ClientErrorReport): void {
  try {
    if (typeof fetch !== "function") return;
    void fetch(`${apiBase()}/api/client-errors`, {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(buildClientErrorReportBody(report))
    }).catch(() => undefined);
  } catch {
    // Reporting must never affect the page.
  }
}
