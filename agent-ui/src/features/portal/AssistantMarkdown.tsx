import { type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useAui, useMessagePartText } from "@assistant-ui/react";
import { makeMarkdownText } from "@assistant-ui/react-ui";
import { ExternalLinkIcon, FileIcon, LinkIcon } from "lucide-react";
import {
  MARKDOWN_COMPONENTS_BY_LANGUAGE,
  MARKDOWN_REHYPE_PLUGINS,
  MARKDOWN_REMARK_PLUGINS,
  MarkdownTable
} from "../markdown/markdown-rendering";
import { InlineVisualization, resolveInlineVisualizationFile } from "../inline-visualization/InlineVisualization";
import { type InlineVisualizationFollowUp } from "../inline-visualization/InlineVisualizationFrame";
import { codexFileCitationPreviewPath, parseCodexFileCitationHref } from "../markdown/file-citations";
import { usePortalI18n } from "./i18n";
import { classifyAssistantLinkHref } from "./assistant-link-behavior";
import {
  buildAssistantContentFileUrl,
  derivePreviewPathWithLabelAnchor,
  flattenNodeText,
  isLikelyHttpUrl,
  normalizeMarkdownAssetTarget,
  preprocessAssistantMarkdown,
  resolveAssistantMarkdownImagePreviewPath,
  resolveThreadPreviewPathFromHref
} from "./assistant-preview-paths";
import {
  ActiveThreadIdContext,
  AttachmentWorkspaceFilesContext,
  PreviewRequestContext,
  workspaceFilePreviewOptions
} from "./portal-contexts";

export function PortalInlineVisualization(props: { filePath: string; label: ReactNode }) {
  const { filePath, label } = props;
  const activeThreadId = useContext(ActiveThreadIdContext);
  const aui = useAui();
  const [followUpNotice, setFollowUpNotice] = useState("");

  useEffect(() => {
    if (!followUpNotice) return;
    const timer = window.setTimeout(() => setFollowUpNotice(""), 6000);
    return () => window.clearTimeout(timer);
  }, [followUpNotice]);

  // Follow-ups from the visual are drafted into the composer, never sent: the
  // user reviews and edits the prompt before deciding to send it.
  const fillComposer = useCallback(
    ({ prompt }: InlineVisualizationFollowUp) => {
      const composer = aui.composer();
      const current = composer.getState().text.trim();
      composer.setText(current ? `${current}\n\n${prompt}` : prompt);
      setFollowUpNotice("已填入输入框，确认后再发送");
      window.requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>(".portal-composer-input-row [contenteditable='true'], .portal-composer-input-row textarea")
          ?.focus();
      });
    },
    [aui]
  );

  const contentPath =
    activeThreadId && filePath
      ? `/api/threads/${encodeURIComponent(activeThreadId)}/visualizations/content?${new URLSearchParams({ file: filePath }).toString()}`
      : "";
  return (
    <InlineVisualization
      contentPath={contentPath}
      storageKey={`${activeThreadId}:${filePath}`}
      label={label}
      onFollowUp={fillComposer}
      notice={followUpNotice}
    />
  );
}

export function AssistantMarkdownImage(props: {
  src?: string;
  alt?: string;
  className?: string;
  title?: string;
  [key: string]: unknown;
}) {
  const { locale, t } = usePortalI18n();
  const { src, alt, className, title, ...rest } = props;
  const activeThreadId = useContext(ActiveThreadIdContext);
  const messagePart = useMessagePartText();
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const previewPath = useMemo(() => {
    if (typeof src !== "string" || !src.trim()) return null;
    return resolveAssistantMarkdownImagePreviewPath({
      src,
      messageText: messagePart.text
    });
  }, [messagePart.text, src]);

  const resolvedSrc = useMemo(() => {
    const normalizedSrc = typeof src === "string" ? normalizeMarkdownAssetTarget(src) : "";
    if (!normalizedSrc) return "";
    if (/^(data|blob):/i.test(normalizedSrc) || isLikelyHttpUrl(normalizedSrc)) return normalizedSrc;
    if (!previewPath) return "";
    return buildAssistantContentFileUrl(previewPath, activeThreadId) ?? "";
  }, [activeThreadId, previewPath, src]);

  const caption = typeof alt === "string" ? alt.trim() : "";
  const imageTitle = typeof title === "string" ? title.trim() : "";
  const ariaLabel = caption || imageTitle || t("thread.openImage");

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

  if (!resolvedSrc) {
    return (
      <span className="assistant-inline-image-unresolved" title={typeof src === "string" ? src : undefined}>
        {t("thread.imageUnresolved")}
      </span>
    );
  }

  const image = (
    <img
      {...rest}
      className={className ? `assistant-inline-image-element ${className}` : "assistant-inline-image-element"}
      src={resolvedSrc}
      alt={caption}
      title={imageTitle || undefined}
      loading="lazy"
    />
  );

  return (
    <span className="assistant-inline-image-card">
      <button
        type="button"
        className="assistant-inline-image-trigger"
        aria-label={ariaLabel}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setLightboxOpen(true);
        }}
      >
        {image}
      </button>
      {caption ? <span className="assistant-inline-image-caption">{caption}</span> : null}
      {lightboxOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="assistant-image-lightbox"
              role="dialog"
              aria-modal="true"
              aria-label={ariaLabel}
              onClick={() => setLightboxOpen(false)}
            >
              <button
                type="button"
                className="assistant-image-lightbox-close"
                aria-label={t("thread.closeImage")}
                onClick={() => setLightboxOpen(false)}
              >
                ×
              </button>
              <figure className="assistant-image-lightbox-figure" onClick={(event) => event.stopPropagation()}>
                <img className="assistant-image-lightbox-image" src={resolvedSrc} alt={caption} />
                {caption || imageTitle ? (
                  <figcaption className="assistant-image-lightbox-caption">{caption || imageTitle}</figcaption>
                ) : null}
              </figure>
            </div>,
            document.body
          )
        : null}
    </span>
  );
}

export function AssistantMarkdownLink(props: {
  href?: string;
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}) {
  const { t } = usePortalI18n();
  const { href, className, children, ...rest } = props;
  const requestPreview = useContext(PreviewRequestContext);
  const attachmentWorkspaceFiles = useContext(AttachmentWorkspaceFilesContext);
  const activeThreadId = useContext(ActiveThreadIdContext);
  const fileCitation = typeof href === "string" ? parseCodexFileCitationHref(href) : null;
  if (fileCitation) {
    const previewPath = codexFileCitationPreviewPath(fileCitation);
    return (
      <a
        className={["assistant-markdown-link", "assistant-markdown-file-citation", className].filter(Boolean).join(" ")}
        href={href}
        aria-label={`Source ${fileCitation.id}: ${fileCitation.displayName}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          requestPreview(
            previewPath,
            workspaceFilePreviewOptions(attachmentWorkspaceFiles, fileCitation.displayName)
          );
        }}
        {...rest}
      >
        <FileIcon size={13} aria-hidden="true" />
        <span>{children}</span>
      </a>
    );
  }
  const inlineVisualizationPath = resolveInlineVisualizationFile(href);
  if (inlineVisualizationPath) {
    return <PortalInlineVisualization filePath={inlineVisualizationPath} label={children} />;
  }
  const previewPath = typeof href === "string" ? resolveThreadPreviewPathFromHref(href, activeThreadId) : null;
  const linkBehavior =
    typeof href === "string" && !previewPath
      ? classifyAssistantLinkHref(href, window.location.href)
      : null;
  if (!previewPath && linkBehavior === "blocked") {
    return <span className={className}>{children}</span>;
  }
  const linkLabel = flattenNodeText(children).trim();
  const previewPathForRequest = previewPath ? derivePreviewPathWithLabelAnchor(previewPath, linkLabel) : "";
  const opensInNewTab = linkBehavior === "new-tab";
  const classes = ["assistant-markdown-link", previewPath ? "assistant-markdown-file-link" : "", className]
    .filter(Boolean)
    .join(" ");
  const LinkGlyph = previewPath ? FileIcon : opensInNewTab ? ExternalLinkIcon : LinkIcon;
  return (
    <a
      className={classes}
      href={href}
      {...rest}
      target={opensInNewTab ? "_blank" : undefined}
      rel={opensInNewTab ? "noopener noreferrer" : undefined}
      title={opensInNewTab ? t("thread.opensNewTab") : undefined}
      aria-label={opensInNewTab && linkLabel ? t("thread.linkNewTab", { label: linkLabel }) : undefined}
      onClick={
        previewPath
          ? (event) => {
              event.preventDefault();
              event.stopPropagation();
              requestPreview(
                previewPathForRequest,
                workspaceFilePreviewOptions(attachmentWorkspaceFiles, linkLabel)
              );
            }
          : undefined
      }
    >
      <LinkGlyph size={15} aria-hidden="true" />
      <span>{children}</span>
    </a>
  );
}

export const AssistantMarkdownText = makeMarkdownText({
  smooth: false,
  preprocess: preprocessAssistantMarkdown,
  rehypePlugins: MARKDOWN_REHYPE_PLUGINS,
  remarkPlugins: MARKDOWN_REMARK_PLUGINS,
  componentsByLanguage: MARKDOWN_COMPONENTS_BY_LANGUAGE,
  components: {
    table: MarkdownTable as any,
    a: AssistantMarkdownLink as any,
    img: AssistantMarkdownImage as any
  }
});
