import { useEffect, useState, type ReactNode } from "react";

import { apiBase, authHeaders, notifyAuthInvalidStatus } from "../../lib/api";
import "./inline-visualization.css";
import {
  InlineVisualizationFrame,
  useInlineVisualizationTheme,
  type InlineVisualizationFollowUp
} from "./InlineVisualizationFrame";

/** Pseudo-route produced by `expandAssistantControlDirectives` for `::codex-inline-vis` lines. */
export const INLINE_VISUALIZATION_HREF_PATH = "/__codex-inline-vis";

export function resolveInlineVisualizationFile(href?: string): string {
  if (!href) return "";
  try {
    const parsed = new URL(href, window.location.origin);
    if (parsed.origin !== window.location.origin || parsed.pathname !== INLINE_VISUALIZATION_HREF_PATH) return "";
    return (parsed.searchParams.get("file") || "").replace(/\\/g, "/").trim();
  } catch {
    return "";
  }
}

function loadErrorMessage(status: number): string {
  if (status === 404) return "可视化已过期或不可用";
  if (status === 403) return "该可视化不可预览";
  return `可视化加载失败（${status}）`;
}

/**
 * An in-conversation visualization card shared by the portal and the admin
 * conversation record. Without `onFollowUp` the visual is read-only: follow-up
 * buttons inside it report that drafting a message is unavailable.
 */
export function InlineVisualization(props: {
  /** API path (without base) returning the visualization HTML fragment. */
  contentPath: string;
  storageKey: string;
  label: ReactNode;
  onFollowUp?: (followUp: InlineVisualizationFollowUp) => void;
  notice?: ReactNode;
}) {
  const { contentPath, storageKey, label, onFollowUp, notice } = props;
  const theme = useInlineVisualizationTheme();
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setHtml("");
    setError("");
    if (!contentPath) {
      setError("可视化已过期或不可用");
      return () => controller.abort();
    }
    fetch(`${apiBase()}${contentPath}`, {
      credentials: "include",
      headers: authHeaders(),
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) {
          notifyAuthInvalidStatus(response.status);
          throw new Error(loadErrorMessage(response.status));
        }
        const contentType = response.headers.get("content-type")?.toLowerCase() || "";
        if (!contentType.includes("html")) throw new Error("仅支持内联展示 HTML 可视化");
        return response.text();
      })
      .then((content) => setHtml(content))
      .catch((reason) => {
        if ((reason as Error).name !== "AbortError") {
          setError(reason instanceof Error ? reason.message : "可视化加载失败");
        }
      });
    return () => controller.abort();
  }, [contentPath]);

  const title = typeof label === "string" ? label : "交互式可视化";
  return (
    // Spans (styled as blocks) because markdown renders the card inside a paragraph.
    <span className="assistant-inline-vis" role="group" aria-label="交互式可视化">
      <span className="assistant-inline-vis-header">
        <span>{label}</span>
        <span className="assistant-inline-vis-notice" role="status" aria-live="polite">
          {notice}
        </span>
      </span>
      {error ? <span className="assistant-inline-vis-state" role="alert">{error}</span> : null}
      {!error && !html ? <span className="assistant-inline-vis-state">正在加载可视化…</span> : null}
      {html ? (
        <InlineVisualizationFrame
          fragment={html}
          title={title}
          storageKey={storageKey}
          theme={theme}
          onFollowUp={onFollowUp}
        />
      ) : null}
    </span>
  );
}
