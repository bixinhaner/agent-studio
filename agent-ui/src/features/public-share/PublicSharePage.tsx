import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";

import { useAuth } from "../auth/AuthProvider";
import { useBranding } from "../branding/BrandingProvider";
import {
  extractMermaidCodeFromPreChildren,
  MARKDOWN_REHYPE_PLUGINS,
  MARKDOWN_REMARK_PLUGINS,
  MarkdownMermaidBlock,
  MarkdownTable
} from "../markdown/markdown-rendering";
import { stripAssistantControlDirectives } from "../markdown/control-directives";
import { normalizeLatexDelimiters } from "../markdown/latex-delimiters";
import { fetchPublicThreadShare, PublicShareAccessError } from "./api";
import type { PublicShareSnapshotMessage, ThreadPublicShareView } from "./types";

async function copyTextToClipboard(value: string): Promise<void> {
  const text = value.trim();
  if (!text) {
    throw new Error("Nothing to copy");
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
    throw new Error("Your browser does not support automatic copy. Please copy manually.");
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

const RAW_KNOWLEDGE_SET_IMAGE_DESTINATION_PATTERN =
  /(!\[[^\]\n]*\]\()(?!(?:<|https?:|data:|blob:|\/public-api\/))(\/usr\/local\/agent-studio\/data\/knowledge-sets\/Docs\/.*?\.(?:png|jpe?g|gif|webp|bmp|svg|avif))(\))/giu;

function publicShareImageUrl(token: string, imagePath: string): string {
  const query = new URLSearchParams({ path: imagePath });
  return `/public-api/thread-shares/${encodeURIComponent(token)}/files/content?${query.toString()}`;
}

function preprocessPublicShareMarkdown(text: string, token: string): string {
  const resolvedText = token.trim()
    ? text.replace(RAW_KNOWLEDGE_SET_IMAGE_DESTINATION_PATTERN, (_match, prefix, destination, suffix) => {
        return `${prefix}<${publicShareImageUrl(token, destination)}>${suffix}`;
      })
    : text;
  return normalizeLatexDelimiters(stripAssistantControlDirectives(resolvedText));
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

function PublicShareMarkdownImage(props: {
  src?: string;
  alt?: string;
  className?: string;
  title?: string;
  [key: string]: unknown;
}) {
  const { src, alt, className, title, ...rest } = props;
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const normalizedSrc = typeof src === "string" ? src.trim() : "";
  const caption = typeof alt === "string" ? alt.trim() : "";
  const imageTitle = typeof title === "string" ? title.trim() : "";
  const ariaLabel = caption || imageTitle || "Open image detail";

  useEffect(() => {
    if (!lightboxOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLightboxOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [lightboxOpen]);

  if (!normalizedSrc) {
    return <span className="public-share-image-missing">Image unavailable</span>;
  }
  if (!/^https?:\/\//i.test(normalizedSrc) && !normalizedSrc.startsWith("/public-api/thread-shares/")) {
    return <span className="public-share-image-missing">{caption || "Image unavailable"}</span>;
  }
  return (
    <span className="public-share-image-card">
      <button
        type="button"
        className="public-share-image-trigger"
        aria-label={ariaLabel}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setLightboxOpen(true);
        }}
      >
        <img
          {...rest}
          className={className ? `public-share-image ${className}` : "public-share-image"}
          src={normalizedSrc}
          alt={caption}
          title={imageTitle || undefined}
          loading="lazy"
        />
      </button>
      {caption ? <span className="public-share-image-caption">{caption}</span> : null}
      {lightboxOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="public-share-image-lightbox"
              role="dialog"
              aria-modal="true"
              aria-label={ariaLabel}
              onClick={() => setLightboxOpen(false)}
            >
              <button
                type="button"
                className="public-share-image-lightbox-close"
                aria-label="Close image detail"
                onClick={() => setLightboxOpen(false)}
              >
                ×
              </button>
              <figure className="public-share-image-lightbox-figure" onClick={(event) => event.stopPropagation()}>
                <img className="public-share-image-lightbox-image" src={normalizedSrc} alt={caption} />
                {caption || imageTitle ? (
                  <figcaption className="public-share-image-lightbox-caption">{caption || imageTitle}</figcaption>
                ) : null}
              </figure>
            </div>,
            document.body
          )
        : null}
    </span>
  );
}

function PublicShareMarkdown(props: { text: string; token: string; className?: string }) {
  const processedText = useMemo(() => preprocessPublicShareMarkdown(props.text, props.token), [props.text, props.token]);
  return (
    <div className={props.className ? `public-share-markdown ${props.className}` : "public-share-markdown"}>
      <ReactMarkdown
        rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
        remarkPlugins={MARKDOWN_REMARK_PLUGINS}
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
          pre: ({ className, children, ...rest }) => {
            const mermaidCode = extractMermaidCodeFromPreChildren(children);
            if (mermaidCode) return <MarkdownMermaidBlock code={mermaidCode} />;
            return <pre className={className ? `aui-md-pre ${className}` : "aui-md-pre"} {...rest}>{children}</pre>;
          },
          table: MarkdownTable as any,
          img: PublicShareMarkdownImage as any
        }}
      >
        {processedText}
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

function buildPublicShareMarkdown(share: ThreadPublicShareView, userLabel: string, assistantLabel: string): string {
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

      lines.push(`### ${assistantLabel}`);
      lines.push("");

      if (processRows.length > 0) {
        lines.push("#### Process Log");
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
        lines.push("#### Final Response");
        lines.push("");
        lines.push(text);
        lines.push("");
      }

      if (sourceParts.length > 0) {
        lines.push("#### References");
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

function PublicShareMessageTime(props: { value?: string }) {
  if (!props.value) return null;
  const label = formatLocalDateTime(props.value);
  if (!label) return null;
  return (
    <time className="public-share-message-time" dateTime={props.value} title={label}>
      {label}
    </time>
  );
}

function processRowKindLabel(kind: string): string {
  if (kind === "reasoning") return "Reasoning";
  if (kind === "tool") return "Tool";
  if (kind === "source") return "Source";
  if (kind === "meta") return "Setup";
  if (kind === "done") return "Done";
  if (kind === "error") return "Error";
  if (kind === "debug") return "Debug";
  return "Step";
}

function UserMessageBlock(props: { message: PublicShareSnapshotMessage; token: string; userLabel: string }) {
  const text = collectMessageText(props.message);
  return (
    <section className="public-share-message public-share-message-user">
      <div className="public-share-message-head">
        <span className="public-share-message-role">{props.userLabel}</span>
        <PublicShareMessageTime value={props.message.createdAt} />
      </div>
      <div className="public-share-message-body">
        <PublicShareMarkdown text={text} token={props.token} />
      </div>
    </section>
  );
}

function AssistantMessageBlock(props: { message: PublicShareSnapshotMessage; token: string; assistantLabel: string }) {
  const text = collectMessageText(props.message);
  const sourceParts = props.message.parts.filter((part) => part.type === "source");
  const processRows = Array.isArray(props.message.processRows) ? props.message.processRows : [];

  return (
    <section className="public-share-message public-share-message-assistant">
      <div className="public-share-message-head">
        <span className="public-share-message-role">{props.assistantLabel}</span>
        <PublicShareMessageTime value={props.message.createdAt} />
      </div>

      {processRows.length > 0 ? (
        <details className="public-share-process-card">
          <summary>
            <span className="public-share-process-summary-copy">
              <span className="public-share-process-summary-label">Process log</span>
              <span className="public-share-process-summary-caption">View how the response was formed from the real assistant trace</span>
            </span>
            <span className="public-share-process-summary-count">{processRows.length} steps</span>
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
                  {row.detail ? <PublicShareMarkdown text={row.detail} token={props.token} className="public-share-process-markdown" /> : null}
                </div>
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      {text ? (
        <div className="public-share-final-card">
          <div className="public-share-final-label">Final response</div>
          <PublicShareMarkdown text={text} token={props.token} className="public-share-final-markdown" />
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

function PublicShareMessageBlock(props: { message: PublicShareSnapshotMessage; token: string; userLabel: string; assistantLabel: string }) {
  if (props.message.role === "user") {
    return <UserMessageBlock message={props.message} token={props.token} userLabel={props.userLabel} />;
  }
  return <AssistantMessageBlock message={props.message} token={props.token} assistantLabel={props.assistantLabel} />;
}

export function PublicSharePage(props: { token?: string }) {
  const { branding } = useBranding();
  const auth = useAuth();
  const token = useMemo(
    () => props.token || extractPublicShareToken(typeof window !== "undefined" ? window.location.pathname : ""),
    [props.token]
  );
  const [share, setShare] = useState<ThreadPublicShareView | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [accessStatus, setAccessStatus] = useState<number | null>(null);
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
      if (auth.loading) return;
      if (!token) {
        setLoading(false);
        setAccessStatus(400);
        setErrorText("Invalid protected link");
        return;
      }
      if (!auth.user) {
        setLoading(false);
        setAccessStatus(401);
        setErrorText("Sign in with an internal employee account to view this conversation.");
        return;
      }
      if (auth.activeOrganization?.type !== "internal") {
        setLoading(false);
        setAccessStatus(403);
        setErrorText("This link is restricted to internal employees. Switch to your internal organization and try again.");
        return;
      }
      setLoading(true);
      setErrorText("");
      setAccessStatus(null);
      try {
        const next = await fetchPublicThreadShare(token);
        if (cancelled) return;
        setShare(next);
      } catch (error) {
        if (cancelled) return;
        setAccessStatus(error instanceof PublicShareAccessError ? error.status : null);
        setErrorText(error instanceof Error ? error.message : "Failed to load public link");
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
  }, [auth.activeOrganization?.type, auth.loading, auth.user, token]);

  useEffect(() => {
    const title = share?.title ? `${share.title} · ${branding.platformName}` : `${branding.platformName} Protected Link`;
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
    let referrer = document.querySelector('meta[name="referrer"]');
    let referrerCreated = false;
    if (!referrer) {
      referrer = document.createElement("meta");
      referrer.setAttribute("name", "referrer");
      document.head.appendChild(referrer);
      referrerCreated = true;
    }
    const previousReferrer = referrer.getAttribute("content");
    referrer.setAttribute("content", "no-referrer");
    return () => {
      if (robots) {
        if (created) {
          robots.remove();
        } else if (previous) {
          robots.setAttribute("content", previous);
        } else {
          robots.removeAttribute("content");
        }
      }
      if (referrer) {
        if (referrerCreated) {
          referrer.remove();
        } else if (previousReferrer) {
          referrer.setAttribute("content", previousReferrer);
        } else {
          referrer.removeAttribute("content");
        }
      }
    };
  }, [branding.platformName, share?.title]);

  const userLabel = share?.user_display_name?.trim() || "User";
  const assistantLabel = branding.assistantName.trim() || branding.platformName;
  const shareMarkdown = useMemo(
    () => (share ? buildPublicShareMarkdown(share, userLabel, assistantLabel) : ""),
    [assistantLabel, share, userLabel]
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
      setActionStatus("Markdown copied");
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : "Copy failed");
    }
  }

  function handleDownloadMarkdown() {
    if (!shareMarkdown) return;
    downloadTextFile(downloadFileName, shareMarkdown);
    setActionStatus(`Downloaded ${downloadFileName}`);
  }

  return (
    <div className="public-share-shell">
      <div className="public-share-aurora" aria-hidden="true" />
      <main className="public-share-layout">
        <header className="public-share-header">
          <div className="public-share-header-top">
            <span className="public-share-kicker">{branding.platformName} Protected Link</span>
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
              ? "Loading protected snapshot"
              : share
                ? `Only signed-in internal employees can view this snapshot. Expires: ${formatLocalDateTime(share.expires_at)}`
                : "This protected link is not available."}
          </p>
          {actionStatus ? <div className="public-share-header-status" role="status">{actionStatus}</div> : null}
        </header>

        {loading ? (
          <section className="public-share-state-card">
            <p>Loading public content...</p>
          </section>
        ) : null}

        {!loading && errorText ? (
          <section className="public-share-state-card public-share-state-card-error">
            <h2>{accessStatus === 401 ? "Sign in required" : accessStatus === 403 ? "Internal access required" : "Link unavailable"}</h2>
            <p>{errorText}</p>
            {accessStatus === 401 ? (
              <button
                type="button"
                className="public-share-header-btn public-share-header-btn-primary"
                onClick={() => void auth.startSignIn()}
              >
                Sign In as Employee
              </button>
            ) : null}
            {accessStatus === 403 ? (
              <a className="public-share-header-btn" href="/">
                Open Workspace
              </a>
            ) : null}
          </section>
        ) : null}

        {!loading && share ? (
          <>
            <section className="public-share-meta-row">
              <div className="public-share-meta-card">
                <span>Shared turns</span>
                <strong>{share.selected_turn_count}</strong>
              </div>
              <div className="public-share-meta-card">
                <span>Thread title</span>
                <strong>{share.snapshot.threadTitle || share.title}</strong>
              </div>
            </section>

            <div className="public-share-turn-list">
              {share.snapshot.turns.map((turn, index) => (
                <article key={turn.id} className="public-share-turn-card">
                  <div className="public-share-turn-index">Turn {index + 1}</div>
                  <div className="public-share-turn-body">
                    {turn.messages.map((message) => (
                      <PublicShareMessageBlock
                        key={message.id}
                        message={message}
                        token={share.token}
                        userLabel={userLabel}
                        assistantLabel={assistantLabel}
                      />
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
