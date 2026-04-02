import { useEffect, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";

import { fetchPublicThreadShare } from "./api";
import type { PublicShareSnapshotMessage, ThreadPublicShareView } from "./types";

async function copyTextToClipboard(value: string): Promise<void> {
  const text = value.trim();
  if (!text) {
    throw new Error("没有可复制的内容");
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "absolute";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error("浏览器不支持自动复制，请手动复制");
  }
}

function downloadTextFile(fileName: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(href);
}

function isHttpUrl(value: string | undefined): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

function PublicShareMarkdownLink(props: {
  href?: string;
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}) {
  const { href, className, children, ...rest } = props;
  if (!isHttpUrl(href)) {
    return <span className={className}>{children}</span>;
  }
  return (
    <a className={className} href={href} target="_blank" rel="noreferrer" {...rest}>
      {children}
    </a>
  );
}

function PublicShareMarkdown(props: { text: string; className?: string }) {
  return (
    <div className={props.className ? `public-share-markdown ${props.className}` : "public-share-markdown"}>
      <ReactMarkdown
        components={{
          h1: ({ className, ...rest }) => <h1 className={className ? `aui-md-h1 ${className}` : "aui-md-h1"} {...rest} />,
          h2: ({ className, ...rest }) => <h2 className={className ? `aui-md-h2 ${className}` : "aui-md-h2"} {...rest} />,
          h3: ({ className, ...rest }) => <h3 className={className ? `aui-md-h3 ${className}` : "aui-md-h3"} {...rest} />,
          h4: ({ className, ...rest }) => <h4 className={className ? `aui-md-h4 ${className}` : "aui-md-h4"} {...rest} />,
          p: ({ className, ...rest }) => <p className={className ? `aui-md-p ${className}` : "aui-md-p"} {...rest} />,
          a: PublicShareMarkdownLink as any,
          ul: ({ className, ...rest }) => <ul className={className ? `aui-md-ul ${className}` : "aui-md-ul"} {...rest} />,
          ol: ({ className, ...rest }) => <ol className={className ? `aui-md-ol ${className}` : "aui-md-ol"} {...rest} />,
          blockquote: ({ className, ...rest }) => (
            <blockquote className={className ? `aui-md-blockquote ${className}` : "aui-md-blockquote"} {...rest} />
          ),
          code: ({ className, ...rest }) =>
            className ? (
              <code className={className} {...rest} />
            ) : (
              <code className="aui-md-inline-code" {...rest} />
            ),
          pre: ({ className, ...rest }) => <pre className={className ? `aui-md-pre ${className}` : "aui-md-pre"} {...rest} />
        }}
      >
        {props.text}
      </ReactMarkdown>
    </div>
  );
}

function formatLocalDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(parsed);
}

function extractPublicShareToken(pathname: string): string {
  const match = pathname.match(/^\/share\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1] || "") : "";
}

function collectMessageText(message: PublicShareSnapshotMessage): string {
  return message.parts
    .filter((part): part is Extract<PublicShareSnapshotMessage["parts"][number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim();
}

function sanitizeFileNameSegment(value: string): string {
  const normalized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80);
  return normalized || "shared-conversation";
}

function buildPublicShareMarkdown(share: ThreadPublicShareView, userLabel: string): string {
  const lines: string[] = [];
  const threadTitle = share.snapshot.threadTitle || share.title;
  lines.push(`# ${threadTitle}`);
  lines.push("");
  lines.push(`> Public link generated at ${formatLocalDateTime(share.created_at)}`);
  lines.push("");

  share.snapshot.turns.forEach((turn, turnIndex) => {
    lines.push(`## Turn ${turnIndex + 1}`);
    lines.push("");

    turn.messages.forEach((message) => {
      if (message.role === "user") {
        const text = collectMessageText(message);
        if (!text) return;
        lines.push(`### ${userLabel}`);
        lines.push("");
        lines.push(text);
        lines.push("");
        return;
      }

      const text = collectMessageText(message);
      const sourceParts = message.parts.filter((part) => part.type === "source");
      const processRows = Array.isArray(message.processRows) ? message.processRows : [];

      lines.push("### Agent Studio");
      lines.push("");

      if (processRows.length > 0) {
        lines.push("#### 过程记录");
        lines.push("");
        processRows.forEach((row, index) => {
          lines.push(`##### Step ${index + 1} · ${row.title}`);
          lines.push("");
          if (row.at) {
            lines.push(`_${formatLocalDateTime(row.at)}_`);
            lines.push("");
          }
          if (row.detail) {
            lines.push(row.detail);
            lines.push("");
          }
        });
      }

      if (text) {
        lines.push("#### 最终回复");
        lines.push("");
        lines.push(text);
        lines.push("");
      }

      if (sourceParts.length > 0) {
        lines.push("#### 参考链接");
        lines.push("");
        sourceParts.forEach((part) => {
          lines.push(`- [${part.title || part.url}](${part.url})`);
        });
        lines.push("");
      }
    });
  });

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim().concat("\n");
}

function formatProcessRowTime(value?: string): string {
  if (!value) return "";
  return formatLocalDateTime(value);
}

function processRowKindLabel(kind: string): string {
  if (kind === "reasoning") return "思考";
  if (kind === "tool") return "工具";
  if (kind === "source") return "来源";
  if (kind === "meta") return "准备";
  if (kind === "done") return "完成";
  if (kind === "error") return "异常";
  if (kind === "debug") return "调试";
  return "步骤";
}

function UserMessageBlock(props: { message: PublicShareSnapshotMessage; userLabel: string }) {
  const text = collectMessageText(props.message);
  return (
    <section className="public-share-message public-share-message-user">
      <div className="public-share-message-head">
        <span className="public-share-message-role">{props.userLabel}</span>
      </div>
      <div className="public-share-message-body">
        <PublicShareMarkdown text={text} />
      </div>
    </section>
  );
}

function AssistantMessageBlock(props: { message: PublicShareSnapshotMessage }) {
  const text = collectMessageText(props.message);
  const sourceParts = props.message.parts.filter((part) => part.type === "source");
  const processRows = Array.isArray(props.message.processRows) ? props.message.processRows : [];

  return (
    <section className="public-share-message public-share-message-assistant">
      <div className="public-share-message-head">
        <span className="public-share-message-role">Agent Studio</span>
      </div>

      {processRows.length > 0 ? (
        <details className="public-share-process-card">
          <summary>
            <span className="public-share-process-summary-copy">
              <span className="public-share-process-summary-label">过程记录</span>
              <span className="public-share-process-summary-caption">按真实助手轨迹查看回答形成过程</span>
            </span>
            <span className="public-share-process-summary-count">{processRows.length} 步</span>
          </summary>
          <ol className="public-share-process-list">
            {processRows.map((row, index) => (
              <li key={row.id || `${props.message.id}-process-${index}`} className="public-share-process-item">
                <div className="public-share-process-node" aria-hidden="true">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                </div>
                <div className="public-share-process-panel">
                  <div className="public-share-process-step-head">
                    <span className={`public-share-process-step-kind public-share-process-step-kind-${row.kind}`}>
                      {processRowKindLabel(row.kind)}
                    </span>
                    <span className="public-share-process-step-title">{row.title}</span>
                    {row.at ? <span className="public-share-process-step-time">{formatProcessRowTime(row.at)}</span> : null}
                  </div>
                  {row.detail ? <PublicShareMarkdown text={row.detail} className="public-share-process-markdown" /> : null}
                </div>
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      {text ? (
        <div className="public-share-final-card">
          <div className="public-share-final-label">最终回复</div>
          <PublicShareMarkdown text={text} className="public-share-final-markdown" />
          {sourceParts.length > 0 ? (
            <div className="public-share-source-list">
              {sourceParts.map((part) => (
                <a key={`${props.message.id}-${part.id}`} href={part.url} target="_blank" rel="noreferrer">
                  {part.title || part.url}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function PublicShareMessageBlock(props: { message: PublicShareSnapshotMessage; userLabel: string }) {
  if (props.message.role === "user") {
    return <UserMessageBlock message={props.message} userLabel={props.userLabel} />;
  }
  return <AssistantMessageBlock message={props.message} />;
}

export function PublicSharePage(props: { token?: string }) {
  const token = useMemo(
    () => props.token || extractPublicShareToken(typeof window !== "undefined" ? window.location.pathname : ""),
    [props.token]
  );
  const [share, setShare] = useState<ThreadPublicShareView | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [actionStatus, setActionStatus] = useState("");

  useEffect(() => {
    document.documentElement.classList.add("public-share-mode");
    document.body.classList.add("public-share-mode");
    return () => {
      document.documentElement.classList.remove("public-share-mode");
      document.body.classList.remove("public-share-mode");
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!token) {
        setLoading(false);
        setErrorText("公开链接无效");
        return;
      }
      setLoading(true);
      setErrorText("");
      try {
        const next = await fetchPublicThreadShare(token);
        if (cancelled) return;
        setShare(next);
      } catch (error) {
        if (cancelled) return;
        setErrorText(error instanceof Error ? error.message : "读取公开链接失败");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    const title = share?.title ? `${share.title} · Public Link` : "Public Link";
    document.title = title;

    let robots = document.querySelector('meta[name="robots"]');
    let created = false;
    if (!robots) {
      robots = document.createElement("meta");
      robots.setAttribute("name", "robots");
      document.head.appendChild(robots);
      created = true;
    }
    const previous = robots.getAttribute("content");
    robots.setAttribute("content", "noindex, nofollow");
    return () => {
      if (!robots) return;
      if (created) {
        robots.remove();
      } else if (previous) {
        robots.setAttribute("content", previous);
      }
    };
  }, [share?.title]);

  const userLabel = share?.user_display_name?.trim() || "用户";
  const shareMarkdown = useMemo(
    () => (share ? buildPublicShareMarkdown(share, userLabel) : ""),
    [share, userLabel]
  );
  const downloadFileName = useMemo(
    () => (share ? `${sanitizeFileNameSegment(share.snapshot.threadTitle || share.title)}.md` : "shared-conversation.md"),
    [share]
  );

  useEffect(() => {
    if (!actionStatus) return;
    const timer = window.setTimeout(() => setActionStatus(""), 2200);
    return () => window.clearTimeout(timer);
  }, [actionStatus]);

  async function handleCopyMarkdown() {
    try {
      await copyTextToClipboard(shareMarkdown);
      setActionStatus("Markdown 已复制");
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : "复制失败");
    }
  }

  function handleDownloadMarkdown() {
    if (!shareMarkdown) return;
    downloadTextFile(downloadFileName, shareMarkdown);
    setActionStatus(`已下载 ${downloadFileName}`);
  }

  return (
    <div className="public-share-shell">
      <div className="public-share-aurora" aria-hidden="true" />
      <main className="public-share-layout">
        <header className="public-share-header">
          <div className="public-share-header-top">
            <span className="public-share-kicker">Agent Studio Public Link</span>
            {share ? (
              <div className="public-share-header-actions">
                <button type="button" className="public-share-header-btn" onClick={() => void handleCopyMarkdown()}>
                  Copy Markdown
                </button>
                <button type="button" className="public-share-header-btn public-share-header-btn-primary" onClick={handleDownloadMarkdown}>
                  Download
                </button>
              </div>
            ) : null}
          </div>
          <h1>{share?.title || "Shared conversation"}</h1>
          <p>
            {loading
              ? "正在加载公开快照"
              : share
                ? `任何拿到链接的人都可以查看此快照。生成时间：${formatLocalDateTime(share.created_at)}`
                : "当前公开链接不可用。"}
          </p>
          {actionStatus ? <div className="public-share-header-status">{actionStatus}</div> : null}
        </header>

        {loading ? (
          <section className="public-share-state-card">
            <p>正在读取公开内容...</p>
          </section>
        ) : null}

        {!loading && errorText ? (
          <section className="public-share-state-card public-share-state-card-error">
            <h2>链接不可用</h2>
            <p>{errorText}</p>
          </section>
        ) : null}

        {!loading && share ? (
          <>
            <section className="public-share-meta-row">
              <div className="public-share-meta-card">
                <span>已分享轮次</span>
                <strong>{share.selected_turn_count}</strong>
              </div>
              <div className="public-share-meta-card">
                <span>线程标题</span>
                <strong>{share.snapshot.threadTitle || share.title}</strong>
              </div>
            </section>

            <div className="public-share-turn-list">
              {share.snapshot.turns.map((turn, index) => (
                <article key={turn.id} className="public-share-turn-card">
                  <div className="public-share-turn-index">Turn {index + 1}</div>
                  <div className="public-share-turn-body">
                    {turn.messages.map((message) => (
                      <PublicShareMessageBlock key={message.id} message={message} userLabel={userLabel} />
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}

export default PublicSharePage;
