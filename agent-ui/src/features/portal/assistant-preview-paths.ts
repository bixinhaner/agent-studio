import { apiBase } from "../../lib/api";
import { expandAssistantControlDirectives } from "../markdown/control-directives";
import { projectCodexFileCitations } from "../markdown/file-citations";
import { normalizeLatexDelimiters } from "../markdown/latex-delimiters";
import { decodeMaybeUri } from "./portal-attachment-upload";

export function flattenNodeText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => flattenNodeText(item)).join("");
  }
  if (typeof value === "object") {
    const props = (value as { props?: { children?: unknown } }).props;
    if (props && "children" in props) {
      return flattenNodeText(props.children);
    }
  }
  return "";
}

export const ASSISTANT_MARKDOWN_LINK_PATTERN = /(!?\[[^\]]*]\()([^)\n]+)(\))/g;
export const RAW_KNOWLEDGE_SET_MARKDOWN_DESTINATION_PATTERN =
  /(!?\[[^\]\n]*\]\()(?!(?:<|https?:|data:|blob:))(\/usr\/local\/agent-studio\/data\/knowledge-sets\/Docs\/.*?\.(?:md|markdown|txt|json|pdf|html|htm|xml|ya?ml|png|jpe?g|gif|webp|bmp|svg|avif))(\))/giu;
export const IMAGE_FILE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"]);
export const ASSISTANT_MARKDOWN_BASE_FILE_EXTENSIONS = new Set([
  "md",
  "markdown",
  "txt",
  "doc",
  "docx",
  "pdf",
  "html",
  "htm",
  "json",
  "yaml",
  "yml",
  "xml"
]);
export const ASSISTANT_PREVIEW_LINK_FILE_EXTENSIONS = new Set([
  ...IMAGE_FILE_EXTENSIONS,
  ...ASSISTANT_MARKDOWN_BASE_FILE_EXTENSIONS,
  "csv",
  "tsv",
  "jsonl",
  "js",
  "jsx",
  "ts",
  "tsx",
  "css",
  "py",
  "java",
  "go",
  "rs",
  "sh",
  "log",
  "sql",
  "ppt",
  "pptx",
  "xls",
  "xlsx"
]);

export function normalizeMarkdownAssetTarget(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const unwrapped =
    trimmed.startsWith("<") && trimmed.endsWith(">") && trimmed.length > 1 ? trimmed.slice(1, -1).trim() : trimmed;
  return decodeMaybeUri(unwrapped);
}

export function preprocessAssistantMarkdown(text: string): string {
  const fileCitations = projectCodexFileCitations(text, "en");
  return normalizeLatexDelimiters(
    expandAssistantControlDirectives(fileCitations.markdown).replace(
      RAW_KNOWLEDGE_SET_MARKDOWN_DESTINATION_PATTERN,
      (_match, prefix, destination, suffix) => {
        return `${prefix}<${destination}>${suffix}`;
      }
    )
  );
}

export function normalizeUrlPathParam(value: string | null): string {
  return value ? normalizePreviewFilePath(decodeMaybeUri(value)) : "";
}

export function fileExtensionFromPreviewPath(filePath: string): string {
  const fileName = fileNameFromPreviewPath(filePath).trim().toLowerCase();
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === fileName.length - 1) return "";
  return fileName.slice(dotIndex + 1);
}

export function isRelativeMarkdownAssetTarget(target: string): boolean {
  const normalized = normalizeMarkdownAssetTarget(target);
  if (!normalized) return false;
  if (normalized.startsWith("#")) return false;
  if (normalized.startsWith("/")) return false;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(normalized)) return false;
  return true;
}

export function resolvePreviewPathFromFileContentHref(href: string): string | null {
  const rawHref = href.trim();
  if (!rawHref) return null;

  try {
    const parsed = new URL(rawHref, window.location.href);
    if (parsed.origin !== window.location.origin) return null;
    if (parsed.pathname === "/api/portal/resources/files/content") {
      const resolved = normalizeUrlPathParam(parsed.searchParams.get("path"));
      return resolved ? `${resolved}${parsed.hash || ""}` : null;
    }
    if (/^\/api\/threads\/[^/]+\/files\/content$/.test(parsed.pathname)) {
      const absolutePath = normalizeUrlPathParam(parsed.searchParams.get("path"));
      return absolutePath ? `${absolutePath}${parsed.hash || ""}` : null;
    }
  } catch {
    return null;
  }

  return null;
}

export function resolvePreviewPathFromMarkdownTarget(target: string): string | null {
  const normalized = normalizeMarkdownAssetTarget(target);
  if (!normalized) return null;
  if (normalized.startsWith("#")) return null;
  if (/^(mailto|tel|javascript|data|blob):/i.test(normalized)) return null;

  const fromFileContentHref = resolvePreviewPathFromFileContentHref(normalized);
  if (fromFileContentHref) return fromFileContentHref;

  if (isLikelyHttpUrl(normalized)) {
    try {
      const parsed = new URL(normalized, window.location.href);
      if (parsed.origin !== window.location.origin) return null;
      const pathname = normalizePreviewFilePath(decodeMaybeUri(parsed.pathname || ""));
      if (!pathname || pathname.startsWith("/api/")) return null;
      return `${pathname}${parsed.hash || ""}`;
    } catch {
      return null;
    }
  }

  if (normalized.startsWith("/")) {
    if (normalized.startsWith("/api/")) return null;
    return normalizePreviewFilePath(normalized);
  }

  return null;
}

export function isLikelyBaseDocumentPreviewPath(previewPath: string): boolean {
  const extension = fileExtensionFromPreviewPath(splitPreviewPathAnchor(previewPath).filePath);
  if (!extension) return false;
  if (IMAGE_FILE_EXTENSIONS.has(extension)) return false;
  return ASSISTANT_MARKDOWN_BASE_FILE_EXTENSIONS.has(extension);
}

export function dirnameFromPreviewPath(filePath: string): string {
  const normalized = splitPreviewPathAnchor(filePath).filePath;
  if (!normalized || normalized === "/") return "/";
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length <= 1) return normalized.startsWith("/") ? "/" : "";
  return `${normalized.startsWith("/") ? "/" : ""}${segments.slice(0, -1).join("/")}`;
}

export function resolveRelativePreviewPath(baseFilePath: string, relativeTarget: string): string | null {
  const normalizedTarget = normalizeMarkdownAssetTarget(relativeTarget);
  if (!normalizedTarget || !isRelativeMarkdownAssetTarget(normalizedTarget)) return null;

  const baseDir = dirnameFromPreviewPath(baseFilePath);
  if (!baseDir) return null;

  const baseSegments = normalizePreviewFilePath(baseDir).split("/").filter(Boolean);
  const relativeSegments = normalizedTarget
    .split(/[\\/]+/g)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const resolvedSegments = [...baseSegments];

  for (const segment of relativeSegments) {
    if (segment === ".") continue;
    if (segment === "..") {
      if (resolvedSegments.length === 0) return null;
      resolvedSegments.pop();
      continue;
    }
    resolvedSegments.push(segment);
  }

  return `${baseDir.startsWith("/") ? "/" : ""}${resolvedSegments.join("/")}`;
}

export function buildAssistantContentFileUrl(previewPath: string, activeThreadId: string): string | null {
  const normalizedPreviewPath = splitPreviewPathAnchor(previewPath).filePath;
  if (!normalizedPreviewPath || normalizedPreviewPath.startsWith("/thread-")) return null;

  const query = new URLSearchParams({ path: normalizedPreviewPath });
  if (isKnowledgeSetPreviewPath(normalizedPreviewPath)) {
    return `${apiBase()}/api/portal/resources/files/content?${query.toString()}`;
  }
  if (!activeThreadId.trim()) return null;
  return `${apiBase()}/api/threads/${encodeURIComponent(activeThreadId.trim())}/files/content?${query.toString()}`;
}

export function derivePreviewPathWithLabelAnchor(previewPath: string, label: string): string {
  const { filePath, anchor } = splitPreviewPathAnchor(previewPath);
  if (!filePath || anchor) return previewPath;
  const extension = fileExtensionFromPreviewPath(filePath);
  if (extension !== "md" && extension !== "markdown") return previewPath;

  const segments = label
    .split("/")
    .map((item) => item.trim())
    .filter(Boolean);
  const dashSegments = label
    .split(/\s+[–—-]\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const sectionLabel = segments.length >= 2 ? segments[segments.length - 1] || "" : dashSegments[dashSegments.length - 1] || "";
  if (!sectionLabel || sectionLabel === label.trim()) return previewPath;
  const sectionAnchor = slugifyPreviewAnchorText(sectionLabel);
  return sectionAnchor ? `${filePath}#${encodeURIComponent(sectionAnchor)}` : previewPath;
}

export function resolveAssistantMarkdownImagePreviewPath(input: {
  src: string;
  messageText: string;
}): string | null {
  const normalizedSrc = normalizeMarkdownAssetTarget(input.src);
  if (!normalizedSrc) return null;

  const directPreviewPath = resolvePreviewPathFromMarkdownTarget(normalizedSrc);
  if (directPreviewPath) return directPreviewPath;
  if (!isRelativeMarkdownAssetTarget(normalizedSrc)) return null;

  let currentBaseDocumentPath: string | null = null;
  let sawMatchingImage = false;
  ASSISTANT_MARKDOWN_LINK_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null = null;

  while ((match = ASSISTANT_MARKDOWN_LINK_PATTERN.exec(input.messageText)) !== null) {
    const fullMatch = match[0] || "";
    const matchTarget = normalizeMarkdownAssetTarget(match[2] || "");
    const previewPath = resolvePreviewPathFromMarkdownTarget(matchTarget);

    if (previewPath && isLikelyBaseDocumentPreviewPath(previewPath)) {
      currentBaseDocumentPath = previewPath;
    }

    if (!fullMatch.startsWith("!")) continue;
    if (matchTarget !== normalizedSrc) continue;
    sawMatchingImage = true;

    if (previewPath) return previewPath;
    if (currentBaseDocumentPath) {
      return resolveRelativePreviewPath(currentBaseDocumentPath, matchTarget);
    }
  }

  if (!currentBaseDocumentPath || !sawMatchingImage) return null;
  return resolveRelativePreviewPath(currentBaseDocumentPath, normalizedSrc);
}

export function isLikelyHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function normalizePreviewFilePath(value: string): string {
  return String(value || "")
    .replace(/\\/g, "/")
    .trim();
}

export function splitPreviewPathAnchor(value: string): { filePath: string; anchor: string } {
  const normalized = normalizePreviewFilePath(value);
  const hashIndex = normalized.indexOf("#");
  if (hashIndex < 0) return { filePath: normalized, anchor: "" };
  return {
    filePath: normalized.slice(0, hashIndex),
    anchor: decodeMaybeUri(normalized.slice(hashIndex + 1)).replace(/^#+/g, "").trim()
  };
}

export function slugifyPreviewAnchorText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[`~!@#$%^&*()+=[\]{}\\|;:'",.<>/?，。！？、（）【】《》]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function fileNameFromPreviewPath(filePath: string): string {
  const normalized = splitPreviewPathAnchor(filePath).filePath;
  if (!normalized) return "Untitled file";
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

export function isKnowledgeSetPreviewPath(pathname: string): boolean {
  const normalized = pathname.trim().replace(/\\/g, "/");
  return normalized.includes("/data/knowledge-sets/");
}

export function resolveThreadPreviewPathFromHref(href: string, threadId: string): string | null {
  const rawHref = href.trim();
  const normalizedThreadId = threadId.trim();
  if (!rawHref) return null;
  if (rawHref.startsWith("#")) return null;
  if (/^(mailto|tel|javascript):/i.test(rawHref)) return null;

  const previewPathFromFileContentHref = resolvePreviewPathFromFileContentHref(rawHref);
  if (previewPathFromFileContentHref) return previewPathFromFileContentHref;

  const directPreviewPath = resolvePreviewPathFromMarkdownTarget(rawHref);
  if (
    directPreviewPath &&
    ASSISTANT_PREVIEW_LINK_FILE_EXTENSIONS.has(fileExtensionFromPreviewPath(directPreviewPath))
  ) {
    return directPreviewPath;
  }
  if (
    isRelativeMarkdownAssetTarget(rawHref) &&
    ASSISTANT_PREVIEW_LINK_FILE_EXTENSIONS.has(fileExtensionFromPreviewPath(rawHref))
  ) {
    return normalizePreviewFilePath(rawHref);
  }

  const resolvePathname = (): string => {
    try {
      const parsed = new URL(rawHref, window.location.href);
      if (parsed.origin !== window.location.origin) return "";
      return `${parsed.pathname || ""}${parsed.hash || ""}`;
    } catch {
      return "";
    }
  };
  const pathnameWithHash = decodeURIComponent(resolvePathname());
  const { filePath: pathname } = splitPreviewPathAnchor(pathnameWithHash);
  if (!pathname || pathname.startsWith("/api/")) return null;
  if (isKnowledgeSetPreviewPath(pathname)) return pathnameWithHash;

  if (!normalizedThreadId) {
    return pathname.includes("/thread-") ? pathnameWithHash : null;
  }

  const threadSegment = `/thread-${normalizedThreadId}`;
  if (pathname !== threadSegment && !pathname.includes(`${threadSegment}/`)) {
    return null;
  }
  return pathnameWithHash;
}
