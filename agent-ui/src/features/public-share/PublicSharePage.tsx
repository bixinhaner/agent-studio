import { useEffect, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";

import { fetchPublicThreadShare } from "./api";
import type { PublicShareSnapshotMessage, ThreadPublicShareView } from "./types";

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

function PublicShareMessageBlock(props: { message: PublicShareSnapshotMessage }) {
  const textParts = props.message.parts.filter((part) => part.type === "text");
  const sourceParts = props.message.parts.filter((part) => part.type === "source");
  const roleLabel = props.message.role === "user" ? "你" : "Assistant";

  return (
    <section className={`public-share-message public-share-message-${props.message.role}`}>
      <div className="public-share-message-head">
        <span className="public-share-message-role">{roleLabel}</span>
      </div>
      <div className="public-share-message-body">
        {textParts.map((part, index) => (
          <div key={`${props.message.id}-text-${index}`} className="public-share-markdown">
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
              {part.text}
            </ReactMarkdown>
          </div>
        ))}
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
    </section>
  );
}

export function PublicSharePage(props: { token?: string }) {
  const token = useMemo(
    () => props.token || extractPublicShareToken(typeof window !== "undefined" ? window.location.pathname : ""),
    [props.token]
  );
  const [share, setShare] = useState<ThreadPublicShareView | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");

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

  return (
    <div className="public-share-shell">
      <div className="public-share-aurora" aria-hidden="true" />
      <main className="public-share-layout">
        <header className="public-share-header">
          <span className="public-share-kicker">Agent Studio Public Link</span>
          <h1>{share?.title || "Shared conversation"}</h1>
          <p>
            {loading
              ? "正在加载公开快照"
              : share
                ? `任何拿到链接的人都可以查看此快照。生成时间：${formatLocalDateTime(share.created_at)}`
                : "当前公开链接不可用。"}
          </p>
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
                      <PublicShareMessageBlock key={message.id} message={message} />
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
