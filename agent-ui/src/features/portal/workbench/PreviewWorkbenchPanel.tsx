import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Spin } from "antd";
import { ChevronLeft, ChevronRight, FileSearch, Search, X } from "lucide-react";
import ReactMarkdown from "react-markdown";

import { api, apiBase, authHeaders, notifyAuthInvalidStatus } from "../../../lib/api";
import {
  extractMermaidCodeFromPreChildren,
  MARKDOWN_REMARK_PLUGINS,
  PREVIEW_MARKDOWN_REHYPE_PLUGINS,
  MarkdownMermaidBlock,
  MarkdownTable
} from "../../markdown/markdown-rendering";
import { parseCodexFileCitationPreviewAnchor } from "../../markdown/file-citations";
import { normalizeLatexDelimiters } from "../../markdown/latex-delimiters";
import { usePortalI18n } from "../i18n";

type ThreadFileRecord = {
  filePath: string;
  displayName: string;
  mimeType: string;
  source: "file_change" | "upload_hint";
  updatedAt: number;
};

type XlsxSheetPreview = {
  name: string;
  rows: string[][];
};

type TextPreviewPayload = {
  kind: "text";
  encoding: string;
  offset: number;
  limit: number;
  lines: Array<{ number: number; text: string }>;
  totalLines: number | null;
  totalLinesKnown: boolean;
  hasPrevious: boolean;
  hasNext: boolean;
  query?: string;
  matchesTruncated?: boolean;
  sizeBytes: number;
  partial: boolean;
};

type TablePreviewPayload = {
  kind: "table";
  format: string;
  sheets: Array<{ name: string; rowCount: number; columnCount: number }>;
  selectedSheet: string;
  rowOffset: number;
  rowLimit: number;
  columnOffset: number;
  columnLimit: number;
  rows: string[][];
  totalRows: number;
  totalColumns: number;
  hasPreviousRows: boolean;
  hasNextRows: boolean;
  hasPreviousColumns: boolean;
  hasNextColumns: boolean;
  partial: boolean;
};

type XlsxCellRange = {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
};

type PptxSlidePreview = {
  title: string;
  lines: string[];
};

type PreviewContentBase = {
  objectUrl: string;
  downloadUrl?: string;
};

type PreviewContent =
  | ({ kind: "image" } & PreviewContentBase)
  | ({ kind: "pdf" } & PreviewContentBase)
  | ({ kind: "html"; html: string } & PreviewContentBase)
  | ({ kind: "text"; text: string } & PreviewContentBase)
  | ({ kind: "paged-text"; data: TextPreviewPayload } & PreviewContentBase)
  | ({ kind: "paged-table"; data: TablePreviewPayload } & PreviewContentBase)
  | ({ kind: "markdown"; text: string; filePath: string } & PreviewContentBase)
  | ({ kind: "docx"; html: string } & PreviewContentBase)
  | ({ kind: "xlsx"; sheets: XlsxSheetPreview[] } & PreviewContentBase)
  | ({ kind: "pptx"; slides: PptxSlidePreview[] } & PreviewContentBase)
  | ({ kind: "unsupported"; reason: string } & PreviewContentBase);

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; content: PreviewContent };

type UploadedFileHint = {
  name?: string;
  path?: string;
  relativePath?: string;
  mimeType?: string;
};

type ThreadArtifactApiRecord = {
  id: string;
  relative_path: string;
  display_name: string;
  mime_type: string | null;
  preview_status: string;
  download_status: string;
  blocked_reason: string | null;
};

type ThreadArtifactPolicyApiRecord = {
  enabled: boolean;
  preview_enabled: boolean;
  download_enabled: boolean;
};

type WorkspaceFileVersionApiRecord = {
  id: string;
  file_id: string;
  version_no: number;
  mime_type: string | null;
  size_bytes: number;
  created_by_type: string;
  change_type: string;
  created_at: string;
};

function formatWorkspaceVersionDate(value: string, locale: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsed);
}

const TEXT_LIKE_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "jsonl",
  "ndjson",
  "yaml",
  "yml",
  "xml",
  "html",
  "htm",
  "csv",
  "tsv",
  "js",
  "jsx",
  "ts",
  "tsx",
  "css",
  "scss",
  "sass",
  "less",
  "py",
  "java",
  "go",
  "rs",
  "sh",
  "bash",
  "zsh",
  "ps1",
  "log",
  "syslog",
  "dbglog",
  "messages",
  "conf",
  "config",
  "properties",
  "ini",
  "env",
  "out",
  "err",
  "toml",
  "sql"
]);

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"]);
const WORD_EXTENSIONS = new Set(["doc", "docx", "odt", "rtf"]);
const POWERPOINT_EXTENSIONS = new Set(["ppt", "pptx", "odp", "odg"]);
const EXCEL_EXTENSIONS = new Set(["xls", "xlsx", "ods"]);
const PAGINATED_OFFICE_EXTENSIONS = new Set([...WORD_EXTENSIONS, ...POWERPOINT_EXTENSIONS, "vsd", "vsdx"]);
const DRAWIO_EXTENSIONS = new Set(["drawio", "dio"]);

const UPLOADED_FILE_TAG_PATTERN = /<uploaded_file\s+([^>]+)>/gi;
const UPLOADED_FILE_ATTR_PATTERN = /([a-zA-Z_][\w-]*)=("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s>]+)/g;
const INTERACTIVE_HTML_PREVIEW_CSP =
  "default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data:; " +
  "style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none';";

export function prepareInteractiveHtmlPreview(html: string): string {
  const csp = `<meta http-equiv="Content-Security-Policy" content="${INTERACTIVE_HTML_PREVIEW_CSP}">`;
  const head = /<head(?:\s[^>]*)?>/i;
  return head.test(html) ? html.replace(head, (match) => `${match}${csp}`) : `${csp}${html}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function fileExtension(name: string): string {
  const normalized = name.trim().toLowerCase();
  const index = normalized.lastIndexOf(".");
  if (index < 0 || index === normalized.length - 1) return "";
  return normalized.slice(index + 1);
}

function xlsxColumnLabel(columnIndex: number): string {
  let value = columnIndex + 1;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + value % 26) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function normalizeFilePath(rawPath: string): string {
  return rawPath.replace(/\\/g, "/").trim();
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function splitPreviewTarget(rawTarget: string): { filePath: string; anchor: string } {
  const normalized = normalizeFilePath(rawTarget);
  const hashIndex = normalized.indexOf("#");
  if (hashIndex < 0) return { filePath: normalized, anchor: "" };
  return {
    filePath: normalized.slice(0, hashIndex),
    anchor: normalizeMarkdownAnchor(normalized.slice(hashIndex + 1))
  };
}

function fileNameFromPath(filePath: string): string {
  const normalized = splitPreviewTarget(filePath).filePath;
  if (!normalized) return "Untitled file";
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] || normalized;
}

function fileDirnameFromPath(filePath: string): string {
  const normalized = splitPreviewTarget(filePath).filePath;
  if (!normalized || normalized === "/") return "/";
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length <= 1) return normalized.startsWith("/") ? "/" : "";
  return `${normalized.startsWith("/") ? "/" : ""}${segments.slice(0, -1).join("/")}`;
}

function isLikelyExternalUrl(value: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value.trim());
}

function normalizeMarkdownAnchor(value: string): string {
  return safeDecodeURIComponent(value.trim())
    .replace(/^#+/g, "")
    .trim();
}

function xlsxColumnNumber(value: string): number {
  let result = 0;
  for (const character of value.trim().toUpperCase()) {
    if (character < "A" || character > "Z") return 0;
    result = result * 26 + (character.charCodeAt(0) - 64);
  }
  return result;
}

export function parseXlsxCellRange(value: string | undefined): XlsxCellRange | null {
  const normalized = String(value || "").trim().replace(/\$/g, "");
  const match = normalized.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i);
  if (!match) return null;
  const startColumn = xlsxColumnNumber(match[1]);
  const startRow = Number.parseInt(match[2], 10);
  const endColumn = xlsxColumnNumber(match[3] || match[1]);
  const endRow = Number.parseInt(match[4] || match[2], 10);
  if (!startColumn || !startRow || !endColumn || !endRow) return null;
  return {
    startRow: Math.min(startRow, endRow),
    endRow: Math.max(startRow, endRow),
    startColumn: Math.min(startColumn, endColumn),
    endColumn: Math.max(startColumn, endColumn)
  };
}

function cellIsInsideRange(row: number, column: number, range: XlsxCellRange | null): boolean {
  if (!range) return false;
  return (
    row >= range.startRow &&
    row <= range.endRow &&
    column >= range.startColumn &&
    column <= range.endColumn
  );
}

function slugifyMarkdownHeading(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[`~!@#$%^&*()+=[\]{}\\|;:'",.<>/?，。！？、（）【】《》]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function flattenReactNodeText(value: ReactNode): string {
  if (value === null || value === undefined || typeof value === "boolean") return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map((item) => flattenReactNodeText(item)).join("");
  if (typeof value === "object" && "props" in value) {
    return flattenReactNodeText((value as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}

function resolveRelativePreviewFilePath(baseFilePath: string, relativeTarget: string): string | null {
  const baseDir = fileDirnameFromPath(baseFilePath);
  const target = relativeTarget.trim().replace(/\\/g, "/");
  if (!baseDir || !target || target.startsWith("#") || target.startsWith("/") || isLikelyExternalUrl(target)) return null;

  const targetWithoutHash = target.split("#", 1)[0] || "";
  const targetWithoutQuery = targetWithoutHash.split("?", 1)[0] || "";
  const baseSegments = baseDir.split("/").filter(Boolean);
  const targetSegments = targetWithoutQuery.split("/").filter(Boolean);
  const resolvedSegments = [...baseSegments];

  for (const segment of targetSegments) {
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

function parseDateToMs(value: unknown): number {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
  }
  return Date.now();
}

function decodeAttributeValue(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    if (value.startsWith("\"")) {
      try {
        const parsed = JSON.parse(value);
        return typeof parsed === "string" ? parsed : String(parsed ?? "");
      } catch {
        return value.slice(1, -1);
      }
    }
    return value.slice(1, -1);
  }
  return value;
}

function parseUploadedFileHints(text: string): UploadedFileHint[] {
  if (!text.trim()) return [];
  const hints: UploadedFileHint[] = [];
  UPLOADED_FILE_TAG_PATTERN.lastIndex = 0;
  let tagMatch: RegExpExecArray | null = null;
  while ((tagMatch = UPLOADED_FILE_TAG_PATTERN.exec(text)) !== null) {
    const attrText = tagMatch[1] || "";
    const hint: UploadedFileHint = {};
    UPLOADED_FILE_ATTR_PATTERN.lastIndex = 0;
    let attrMatch: RegExpExecArray | null = null;
    while ((attrMatch = UPLOADED_FILE_ATTR_PATTERN.exec(attrText)) !== null) {
      const key = (attrMatch[1] || "").trim();
      const value = decodeAttributeValue(attrMatch[2] || "");
      if (key === "name") hint.name = value;
      if (key === "path") hint.path = value;
      if (key === "relativePath") hint.relativePath = value;
      if (key === "mimeType") hint.mimeType = value;
    }
    if (hint.path || hint.relativePath) hints.push(hint);
  }
  return hints;
}

function parseFileChangeDetailLines(detail: string): Array<{ kind: string; path: string }> {
  if (!detail.trim()) return [];
  return detail
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([^:]+):\s*(.+)$/);
      if (!match) return null;
      const kind = (match[1] || "").trim() || "update";
      const filePath = (match[2] || "").trim();
      if (!filePath) return null;
      return {
        kind,
        path: filePath
      };
    })
    .filter((item): item is { kind: string; path: string } => Boolean(item));
}

function addOrUpdateFile(
  bucket: Map<string, ThreadFileRecord>,
  input: {
    filePath: string;
    displayName?: string;
    mimeType?: string;
    source: ThreadFileRecord["source"];
    updatedAt: number;
  }
) {
  const normalizedPath = normalizeFilePath(input.filePath);
  if (!normalizedPath) return;
  const key = normalizedPath;
  const existing = bucket.get(key);
  const nextDisplayName = asString(input.displayName) || fileNameFromPath(normalizedPath);
  const nextMimeType = asString(input.mimeType);
  const next: ThreadFileRecord = {
    filePath: normalizedPath,
    displayName: nextDisplayName || "Untitled file",
    mimeType: nextMimeType || existing?.mimeType || "",
    source: input.source,
    updatedAt: Math.max(input.updatedAt, existing?.updatedAt ?? 0)
  };
  if (existing) {
    bucket.set(key, {
      ...existing,
      ...next,
      displayName: next.displayName || existing.displayName,
      mimeType: next.mimeType || existing.mimeType
    });
    return;
  }
  bucket.set(key, next);
}

function collectThreadFiles(messages: readonly unknown[]): ThreadFileRecord[] {
  const files = new Map<string, ThreadFileRecord>();

  for (const message of messages) {
    const msg = asRecord(message);
    if (!msg) continue;
    const updatedAt = parseDateToMs(msg.createdAt);

    const collectFromText = (textValue: unknown) => {
      const text = asString(textValue);
      if (!text) return;
      const hints = parseUploadedFileHints(text);
      for (const hint of hints) {
        const filePath = asString(hint.relativePath) || asString(hint.path);
        if (!filePath) continue;
        addOrUpdateFile(files, {
          filePath,
          displayName: asString(hint.name),
          mimeType: asString(hint.mimeType),
          source: "upload_hint",
          updatedAt
        });
      }
    };

    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const part of content) {
      const partObj = asRecord(part);
      if (!partObj) continue;
      const partType = asString(partObj.type);
      if (partType === "text") {
        collectFromText(partObj.text);
        continue;
      }
      if (partType !== "data") continue;

      const dataName = asString(partObj.name);
      const payload = asRecord(partObj.data);
      if (!payload) continue;
      if (dataName === "codex_file_change") {
        const changes = Array.isArray(payload.changes) ? payload.changes : [];
        for (const change of changes) {
          const changeObj = asRecord(change);
          if (!changeObj) continue;
          const filePath = asString(changeObj.path);
          if (!filePath) continue;
          addOrUpdateFile(files, {
            filePath,
            source: "file_change",
            updatedAt
          });
        }
        continue;
      }
      if (dataName === "codex_process" && asString(payload.item_type) === "file_change") {
        const detail = asString(payload.detail);
        const parsed = parseFileChangeDetailLines(detail);
        for (const item of parsed) {
          addOrUpdateFile(files, {
            filePath: item.path,
            source: "file_change",
            updatedAt
          });
        }
      }
    }

    const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
    for (const attachment of attachments) {
      const attachmentObj = asRecord(attachment);
      if (!attachmentObj) continue;
      const attachmentName = asString(attachmentObj.name);
      const attachmentMimeType = asString(attachmentObj.contentType);
      const attachmentContent = Array.isArray(attachmentObj.content) ? attachmentObj.content : [];
      for (const part of attachmentContent) {
        const partObj = asRecord(part);
        if (!partObj || asString(partObj.type) !== "text") continue;
        const text = asString(partObj.text);
        if (!text) continue;
        const hints = parseUploadedFileHints(text);
        for (const hint of hints) {
          const filePath = asString(hint.relativePath) || asString(hint.path);
          if (!filePath) continue;
          addOrUpdateFile(files, {
            filePath,
            displayName: asString(hint.name) || attachmentName,
            mimeType: asString(hint.mimeType) || attachmentMimeType,
            source: "upload_hint",
            updatedAt
          });
        }
      }
    }
  }

  const sorted = Array.from(files.values()).sort((left, right) => right.updatedAt - left.updatedAt);
  const generated = sorted.filter((item) => item.source === "file_change");
  return generated.length > 0 ? generated : sorted;
}

function isTextLikeMime(mimeType: string): boolean {
  const normalized = mimeType.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.startsWith("text/")) return true;
  return [
    "application/json",
    "application/xml",
    "application/yaml",
    "application/toml",
    "application/javascript"
  ].some((item) => normalized.includes(item));
}

function resolvePreviewKind(file: ThreadFileRecord, responseMimeType: string): PreviewContent["kind"] {
  const extension = fileExtension(file.displayName || file.filePath);
  const mimeType = (responseMimeType || file.mimeType || "").toLowerCase();

  if (mimeType.startsWith("image/") || IMAGE_EXTENSIONS.has(extension)) return "image";
  if (mimeType.includes("pdf") || extension === "pdf") return "pdf";
  if (mimeType.includes("html") || extension === "html" || extension === "htm") return "html";
  if (mimeType.includes("wordprocessingml") || WORD_EXTENSIONS.has(extension)) return "docx";
  if (mimeType.includes("spreadsheetml") || mimeType.includes("excel") || EXCEL_EXTENSIONS.has(extension)) {
    return "xlsx";
  }
  if (mimeType.includes("presentationml") || mimeType.includes("powerpoint") || POWERPOINT_EXTENSIONS.has(extension)) {
    return "pptx";
  }
  if (isTextLikeMime(mimeType) || TEXT_LIKE_EXTENSIONS.has(extension)) return "text";
  return "unsupported";
}

export function supportsPaginatedOfficePreview(fileName: string, mimeType = ""): boolean {
  const extension = fileExtension(fileName);
  if (PAGINATED_OFFICE_EXTENSIONS.has(extension)) return true;
  const normalizedMime = mimeType.trim().toLowerCase();
  return (
    normalizedMime.includes("wordprocessingml") ||
    normalizedMime.includes("msword") ||
    normalizedMime.includes("presentationml") ||
    normalizedMime.includes("powerpoint") ||
    normalizedMime.includes("opendocument.text") ||
    normalizedMime.includes("opendocument.presentation") ||
    normalizedMime.includes("opendocument.graphics") ||
    normalizedMime.includes("rtf")
  );
}

function isKnowledgeSetFilePath(filePath: string): boolean {
  const normalized = normalizeFilePath(filePath);
  return normalized.includes("/data/knowledge-sets/");
}

function buildPreviewFileContentUrl(threadId: string, filePath: string, options?: { artifactMode?: boolean; disposition?: "inline" | "attachment" }): string | null {
  const normalizedPath = splitPreviewTarget(filePath).filePath;
  if (!normalizedPath) return null;
  const query = new URLSearchParams({ path: normalizedPath });
  if (options?.disposition) {
    query.set("disposition", options.disposition);
  }
  if (isKnowledgeSetFilePath(normalizedPath)) {
    return `${apiBase()}/api/portal/resources/files/content?${query.toString()}`;
  }
  if (!threadId.trim()) return null;
  if (options?.artifactMode) {
    return `${apiBase()}/api/threads/${encodeURIComponent(threadId.trim())}/artifacts/content?${query.toString()}`;
  }
  return `${apiBase()}/api/threads/${encodeURIComponent(threadId.trim())}/files/content?${query.toString()}`;
}

function resolveMarkdownLinkedFilePath(baseFilePath: string, rawTarget: string): { filePath: string; anchor: string } | null {
  const target = rawTarget.trim();
  if (!target || /^(mailto|tel|javascript|data|blob):/i.test(target)) return null;

  if (target.startsWith("#")) {
    return {
      filePath: splitPreviewTarget(baseFilePath).filePath,
      anchor: normalizeMarkdownAnchor(target.slice(1))
    };
  }

  if (isLikelyExternalUrl(target)) {
    try {
      const parsed = new URL(target, window.location.href);
      if (parsed.origin !== window.location.origin) return null;
      if (
        parsed.pathname === "/api/portal/resources/files/content" ||
        /^\/api\/threads\/[^/]+\/(?:files|artifacts)\/content$/.test(parsed.pathname)
      ) {
        const filePath = normalizeFilePath(safeDecodeURIComponent(parsed.searchParams.get("path") || ""));
        if (!filePath) return null;
        return {
          filePath,
          anchor: normalizeMarkdownAnchor(parsed.hash.slice(1))
        };
      }
      const filePath = normalizeFilePath(safeDecodeURIComponent(parsed.pathname || ""));
      if (!filePath || filePath.startsWith("/api/")) return null;
      return {
        filePath,
        anchor: normalizeMarkdownAnchor(parsed.hash.slice(1))
      };
    } catch {
      return null;
    }
  }

  if (target.startsWith("/")) {
    return splitPreviewTarget(target.split("?", 1)[0] || target);
  }

  const relativePath = resolveRelativePreviewFilePath(baseFilePath, target);
  if (!relativePath) return null;
  const anchor = target.includes("#") ? normalizeMarkdownAnchor(target.slice(target.indexOf("#") + 1)) : "";
  return { filePath: relativePath, anchor };
}

type PreviewFetchOptions = {
  mode?: "pdf" | "auto" | "text" | "table" | "diagram";
  params?: Record<string, string | number | undefined>;
};

function appendPreviewOptions(query: URLSearchParams, options?: PreviewFetchOptions): void {
  if (options?.mode) query.set("preview", options.mode);
  for (const [key, value] of Object.entries(options?.params || {})) {
    if (value !== undefined && String(value).trim()) query.set(key, String(value));
  }
}

async function fetchThreadFileBlob(
  threadId: string,
  filePath: string,
  options?: PreviewFetchOptions
): Promise<Response> {
  const query = new URLSearchParams({ path: filePath });
  appendPreviewOptions(query, options);
  const response = await fetch(
    `${apiBase()}/api/threads/${encodeURIComponent(threadId)}/files/content?${query.toString()}`,
    {
      method: "GET",
      credentials: "include",
      headers: {
        ...authHeaders()
      }
    }
  );
  if (!response.ok) {
    notifyAuthInvalidStatus(response.status);
    const text = await response.text();
    let detail = `Failed to read file (${response.status})`;
    if (text) {
      try {
        const payload = JSON.parse(text) as { detail?: string };
        if (typeof payload.detail === "string" && payload.detail.trim()) {
          detail = payload.detail.trim();
        }
      } catch {
        // ignore non-json response body
      }
    }
    throw new Error(detail);
  }
  return response;
}

async function fetchWorkspaceFileBlob(
  fileId: string,
  versionId?: string,
  options?: PreviewFetchOptions,
  workspaceApiBasePath = "/api/portal/workspace"
): Promise<Response> {
  const query = new URLSearchParams();
  if (versionId) query.set("version_id", versionId);
  appendPreviewOptions(query, options);
  const response = await fetch(
    `${apiBase()}${workspaceApiBasePath}/files/${encodeURIComponent(fileId)}/content${query.toString() ? `?${query.toString()}` : ""}`,
    {
      method: "GET",
      credentials: "include",
      headers: authHeaders()
    }
  );
  if (!response.ok) {
    notifyAuthInvalidStatus(response.status);
    const text = await response.text();
    let detail = `Failed to read workspace file (${response.status})`;
    if (text) {
      try {
        const payload = JSON.parse(text) as { detail?: string };
        if (typeof payload.detail === "string" && payload.detail.trim()) detail = payload.detail.trim();
      } catch {
        // ignore non-json response body
      }
    }
    throw new Error(detail);
  }
  return response;
}

async function resolveThreadArtifact(threadId: string, filePath: string): Promise<{
  artifact: ThreadArtifactApiRecord;
  policy: ThreadArtifactPolicyApiRecord;
}> {
  const query = new URLSearchParams({ path: filePath });
  const response = await fetch(
    `${apiBase()}/api/threads/${encodeURIComponent(threadId)}/artifacts/resolve?${query.toString()}`,
    {
      method: "GET",
      credentials: "include",
      headers: {
        ...authHeaders()
      }
    }
  );
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  if (text) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      payload = {};
    }
  }
  if (!response.ok) {
    notifyAuthInvalidStatus(response.status);
    const detail =
      payload && typeof payload.detail === "string" && payload.detail.trim()
        ? payload.detail.trim()
        : `Failed to resolve artifact (${response.status})`;
    throw new Error(detail);
  }
  const artifact = asRecord((payload as Record<string, unknown>).artifact) || {};
  const policy = asRecord((payload as Record<string, unknown>).policy) || {};
  return {
    artifact: {
      id: asString(artifact.id),
      relative_path: asString(artifact.relative_path),
      display_name: asString(artifact.display_name),
      mime_type: asString(artifact.mime_type) || null,
      preview_status: asString(artifact.preview_status),
      download_status: asString(artifact.download_status),
      blocked_reason: asString(artifact.blocked_reason) || null
    },
    policy: {
      enabled: policy.enabled === true,
      preview_enabled: policy.preview_enabled === true,
      download_enabled: policy.download_enabled === true
    }
  };
}

async function fetchThreadArtifactFileBlob(
  threadId: string,
  filePath: string,
  disposition: "inline" | "attachment" = "inline",
  options?: PreviewFetchOptions
): Promise<Response> {
  const query = new URLSearchParams({ path: filePath, disposition });
  appendPreviewOptions(query, options);
  const response = await fetch(
    `${apiBase()}/api/threads/${encodeURIComponent(threadId)}/artifacts/content?${query.toString()}`,
    {
      method: "GET",
      credentials: "include",
      headers: {
        ...authHeaders()
      }
    }
  );
  if (!response.ok) {
    notifyAuthInvalidStatus(response.status);
    const text = await response.text();
    let detail = `Failed to read artifact (${response.status})`;
    if (text) {
      try {
        const payload = JSON.parse(text) as { detail?: string };
        if (typeof payload.detail === "string" && payload.detail.trim()) {
          detail = payload.detail.trim();
        }
      } catch {
        // ignore non-json response body
      }
    }
    throw new Error(detail);
  }
  return response;
}

async function fetchPortalResourceFileBlob(filePath: string, options?: PreviewFetchOptions): Promise<Response> {
  const query = new URLSearchParams({ path: filePath });
  appendPreviewOptions(query, options);
  const response = await fetch(`${apiBase()}/api/portal/resources/files/content?${query.toString()}`, {
    method: "GET",
    credentials: "include",
    headers: {
      ...authHeaders()
    }
  });
  if (!response.ok) {
    notifyAuthInvalidStatus(response.status);
    const text = await response.text();
    let detail = `Failed to read knowledge set file (${response.status})`;
    if (text) {
      try {
        const payload = JSON.parse(text) as { detail?: string };
        if (typeof payload.detail === "string" && payload.detail.trim()) {
          detail = payload.detail.trim();
        }
      } catch {
        // ignore non-json response body
      }
    }
    throw new Error(detail);
  }
  return response;
}

async function fetchPaginatedOfficePreview(
  usePaginatedPreview: boolean,
  fetchFile: (options?: PreviewFetchOptions) => Promise<Response>
): Promise<Response> {
  if (!usePaginatedPreview) return fetchFile();
  try {
    return await fetchFile({ mode: "pdf" });
  } catch {
    return fetchFile();
  }
}

async function convertDocxToHtml(arrayBuffer: ArrayBuffer): Promise<string> {
  const mammothModule = (await import("mammoth")) as {
    convertToHtml?: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value?: string }>;
    default?: {
      convertToHtml?: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value?: string }>;
    };
  };
  const converter = mammothModule.default?.convertToHtml || mammothModule.convertToHtml;
  if (!converter) {
    throw new Error("DOCX parser is unavailable");
  }
  const result = await converter({ arrayBuffer });
  return asString(result?.value);
}

async function convertXlsxToSheets(arrayBuffer: ArrayBuffer, targetSheetName = ""): Promise<XlsxSheetPreview[]> {
  const xlsxModule = await import("xlsx");
  const workbook = xlsxModule.read(arrayBuffer, { type: "array" });
  const normalizedTargetSheet = targetSheetName.trim();
  const sheetNames = [
    ...workbook.SheetNames.slice(0, 6),
    ...(normalizedTargetSheet && workbook.SheetNames.includes(normalizedTargetSheet) ? [normalizedTargetSheet] : [])
  ].filter((sheetName, index, values) => values.indexOf(sheetName) === index);
  return sheetNames.map((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const rawRows = xlsxModule.utils.sheet_to_json(worksheet, {
      header: 1,
      raw: false,
      defval: ""
    }) as unknown[];
    const rows = rawRows.slice(0, 120).map((row) => {
      if (!Array.isArray(row)) return [String(row ?? "")];
      return row.slice(0, 24).map((cell) => String(cell ?? ""));
    });
    return {
      name: sheetName,
      rows: rows.length > 0 ? rows : [["(Empty sheet)"]]
    };
  });
}

function slideOrder(name: string): number {
  const match = name.match(/slide(\d+)\.xml$/i);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const order = Number(match[1]);
  return Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER;
}

async function convertPptxToSlides(arrayBuffer: ArrayBuffer): Promise<PptxSlidePreview[]> {
  const jszipModule = await import("jszip");
  const JSZip = jszipModule.default;
  const zip = await JSZip.loadAsync(arrayBuffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((left, right) => slideOrder(left) - slideOrder(right))
    .slice(0, 30);

  const parser = new DOMParser();
  const slides: PptxSlidePreview[] = [];

  for (const [index, name] of slideFiles.entries()) {
    const entry = zip.file(name);
    if (!entry) continue;
    const xml = await entry.async("text");
    const doc = parser.parseFromString(xml, "application/xml");
    const textNodes = Array.from(doc.getElementsByTagName("a:t"));
    const fallbackNodes = textNodes.length > 0 ? textNodes : Array.from(doc.getElementsByTagName("t"));
    const lines = fallbackNodes
      .map((node) => (node.textContent || "").trim())
      .filter(Boolean)
      .slice(0, 120);
    slides.push({
      title: `Slide ${index + 1}`,
      lines: lines.length > 0 ? lines : ["(Blank slide)"]
    });
  }

  return slides;
}

function formatUpdatedAt(ms: number): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function preprocessPreviewMarkdown(text: string): string {
  return normalizeLatexDelimiters(
    text.replace(
      /<a\s+name=(?:"([^"]+)"|'([^']+)')[^>]*>\s*<\/a>/gi,
      (_match, doubleQuotedName: string, singleQuotedName: string) => {
        const rawName = (doubleQuotedName || singleQuotedName || "").trim();
        const escapedName = rawName.replace(/"/g, "&quot;");
        return escapedName ? `<a id="${escapedName}"></a>` : "";
      }
    )
  );
}

function createPreviewMarkdownHeading(tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") {
  return function PreviewMarkdownHeading(props: { children?: ReactNode; className?: string }) {
    const headingText = flattenReactNodeText(props.children);
    const anchor = slugifyMarkdownHeading(headingText);
    const Tag = tag;
    return (
      <Tag
        className={props.className}
        id={anchor || undefined}
        data-preview-anchor={anchor || undefined}
        data-preview-anchor-text={headingText.trim() || undefined}
      >
        {props.children}
      </Tag>
    );
  };
}

function parseLineAnchor(value: string): number | null {
  const normalized = normalizeMarkdownAnchor(value);
  const match = normalized.match(/^l(\d+)(?:-l?\d+)?$/i);
  if (!match) return null;
  const line = Number(match[1]);
  if (!Number.isFinite(line) || line <= 0) return null;
  return Math.floor(line);
}

function deriveHeadingAnchorFromLine(text: string, targetLine: number): string {
  if (!text.trim() || targetLine <= 0) return "";
  const lines = text.split(/\r?\n/g);
  type HeadingPoint = { line: number; anchor: string };
  const headings: HeadingPoint[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] || "";
    const match = raw.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const headingText = (match[2] || "").trim();
    if (!headingText) continue;
    const anchor = slugifyMarkdownHeading(headingText);
    if (!anchor) continue;
    headings.push({ line: index + 1, anchor });
  }
  if (headings.length === 0) return "";
  let selected = headings[0]!.anchor;
  for (const point of headings) {
    if (point.line > targetLine) break;
    selected = point.anchor;
  }
  return selected;
}

function escapeCssIdSelector(value: string): string {
  if (!value) return "";
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g, "\\$&");
}

type PreviewTargetBlock = "start" | "center";

export function alignPreviewTarget(
  target: HTMLElement,
  block: PreviewTargetBlock,
  behavior: ScrollBehavior
): void {
  const scroller = target.closest<HTMLElement>(".preview-viewer-body");
  if (!scroller) {
    target.scrollIntoView({ block, behavior });
    return;
  }
  const scrollerRect = scroller.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const targetTop = scroller.scrollTop + targetRect.top - scrollerRect.top;
  const top = block === "center"
    ? targetTop - Math.max(0, (scroller.clientHeight - targetRect.height) / 2)
    : targetTop - 12;
  scroller.scrollTo({ top: Math.max(0, top), behavior });
}

function keepPreviewTargetAligned(input: {
  root: HTMLElement;
  target: HTMLElement;
  block: PreviewTargetBlock;
  behavior: ScrollBehavior;
  stabilize: boolean;
}): () => void {
  const scroller = input.target.closest<HTMLElement>(".preview-viewer-body");
  let cancelled = false;
  let resizeFrame = 0;
  const timeouts: number[] = [];

  const align = (behavior: ScrollBehavior) => {
    if (cancelled || !input.target.isConnected) return;
    alignPreviewTarget(input.target, input.block, behavior);
  };
  const stopAutomaticAlignment = () => {
    cancelled = true;
  };
  const onContentLoad = () => align("auto");

  const firstFrame = requestAnimationFrame(() => {
    requestAnimationFrame(() => align(input.behavior));
  });
  let resizeObserver: ResizeObserver | undefined;
  let settleTimeout = 0;
  if (input.stabilize) {
    for (const delay of [160, 480, 1000]) {
      timeouts.push(window.setTimeout(() => align("auto"), delay));
    }
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => align("auto"));
      });
      resizeObserver.observe(input.root);
      if (scroller) resizeObserver.observe(scroller);
    }
    input.root.addEventListener("load", onContentLoad, true);
    scroller?.addEventListener("wheel", stopAutomaticAlignment, { passive: true });
    scroller?.addEventListener("touchstart", stopAutomaticAlignment, { passive: true });
    scroller?.addEventListener("pointerdown", stopAutomaticAlignment, { passive: true });
    settleTimeout = window.setTimeout(stopAutomaticAlignment, 1800);
  }

  return () => {
    cancelled = true;
    cancelAnimationFrame(firstFrame);
    cancelAnimationFrame(resizeFrame);
    timeouts.forEach((timeout) => window.clearTimeout(timeout));
    if (settleTimeout) window.clearTimeout(settleTimeout);
    resizeObserver?.disconnect();
    input.root.removeEventListener("load", onContentLoad, true);
    scroller?.removeEventListener("wheel", stopAutomaticAlignment);
    scroller?.removeEventListener("touchstart", stopAutomaticAlignment);
    scroller?.removeEventListener("pointerdown", stopAutomaticAlignment);
  };
}

function PreviewMarkdown(props: {
  text: string;
  filePath: string;
  threadId: string;
  artifactMode?: boolean;
  anchor: string;
  jumpToken: number;
  onNavigate(target: { filePath: string; anchor: string }): void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const alignedAnchorRef = useRef("");
  const normalizedAnchor = useMemo(() => normalizeMarkdownAnchor(props.anchor), [props.anchor]);
  const processedText = useMemo(() => preprocessPreviewMarkdown(props.text), [props.text]);

  useEffect(() => {
    if (!normalizedAnchor) return;
    const root = rootRef.current;
    if (!root) return;

    const lineAnchor = parseLineAnchor(normalizedAnchor);
    let target: HTMLElement | undefined;
    if (lineAnchor) {
      const headingAnchor = deriveHeadingAnchorFromLine(props.text, lineAnchor);
      if (!headingAnchor) return;
      target = Array.from(root.querySelectorAll<HTMLElement>("[data-preview-anchor]")).find((element) => {
        const anchor = element.dataset.previewAnchor || "";
        return anchor === headingAnchor;
      });
    } else {
      const candidates = new Set([normalizedAnchor, slugifyMarkdownHeading(normalizedAnchor)].filter(Boolean));
      target = Array.from(root.querySelectorAll<HTMLElement>("[data-preview-anchor]")).find((element) => {
        const anchor = element.dataset.previewAnchor || "";
        const anchorText = element.dataset.previewAnchorText || "";
        return candidates.has(anchor) || candidates.has(slugifyMarkdownHeading(anchorText));
      });
    }

    if (!target) {
      const escapedAnchor = escapeCssIdSelector(normalizedAnchor);
      if (escapedAnchor) {
        target = root.querySelector<HTMLElement>(`#${escapedAnchor}`) || undefined;
      }
    }

    if (!target) return;
    root.querySelectorAll(".preview-markdown-anchor-hit").forEach((element) => {
      element.classList.remove("preview-markdown-anchor-hit");
    });
    target.classList.add("preview-markdown-anchor-hit");
    const requestKey = `${props.filePath}#${normalizedAnchor}`;
    const repeatedJump = alignedAnchorRef.current === requestKey;
    alignedAnchorRef.current = requestKey;
    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    return keepPreviewTargetAligned({
      root,
      target,
      block: "start",
      behavior: repeatedJump && !prefersReducedMotion ? "smooth" : "auto",
      stabilize: !repeatedJump
    });
  }, [normalizedAnchor, processedText, props.filePath, props.jumpToken, props.text]);

  const components = useMemo(
    () => ({
      h1: createPreviewMarkdownHeading("h1"),
      h2: createPreviewMarkdownHeading("h2"),
      h3: createPreviewMarkdownHeading("h3"),
      h4: createPreviewMarkdownHeading("h4"),
      h5: createPreviewMarkdownHeading("h5"),
      h6: createPreviewMarkdownHeading("h6"),
      a: ({
        href,
        children,
        className,
        id,
        name
      }: {
        href?: string;
        children?: ReactNode;
        className?: string;
        id?: string;
        name?: string;
      }) => {
        if (!href) {
          const inlineAnchorId = normalizeMarkdownAnchor(id || name || "");
          if (!inlineAnchorId) return <span className={className}>{children}</span>;
          const anchorText = flattenReactNodeText(children).trim();
          return (
            <span
              id={inlineAnchorId}
              className={className}
              data-preview-anchor={inlineAnchorId}
              data-preview-anchor-text={anchorText || undefined}
              aria-hidden={!anchorText}
            >
              {children}
            </span>
          );
        }
        const linkedFile = resolveMarkdownLinkedFilePath(props.filePath, href);
        if (!linkedFile) {
          return (
            <a className={className} href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          );
        }
        const fileUrl = buildPreviewFileContentUrl(props.threadId, linkedFile.filePath, {
          artifactMode: props.artifactMode
        });
        const resolvedHref = fileUrl
          ? linkedFile.anchor
            ? `${fileUrl}#${encodeURIComponent(linkedFile.anchor)}`
            : fileUrl
          : href;
        return (
          <a
            className={className}
            href={resolvedHref}
            onClick={(event) => {
              if (event.defaultPrevented) return;
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              props.onNavigate(linkedFile);
            }}
          >
            {children}
          </a>
        );
      },
      img: ({ src, alt, title, className }: { src?: string; alt?: string; title?: string; className?: string }) => {
        const linkedFile = src ? resolveMarkdownLinkedFilePath(props.filePath, src) : null;
        const imageUrl = linkedFile
          ? buildPreviewFileContentUrl(props.threadId, linkedFile.filePath, { artifactMode: props.artifactMode })
          : src || "";
        if (!imageUrl) return null;
        return <img className={className} src={imageUrl} alt={alt || title || "Document image"} title={title} loading="lazy" />;
      },
      pre: ({ children, className, ...rest }: { children?: ReactNode; className?: string }) => {
        const mermaidCode = extractMermaidCodeFromPreChildren(children);
        if (mermaidCode) return <MarkdownMermaidBlock code={mermaidCode} />;
        return <pre className={className} {...rest}>{children}</pre>;
      },
      table: MarkdownTable
    }),
    [props.artifactMode, props.filePath, props.onNavigate, props.threadId]
  );

  return (
    <div ref={rootRef} className="preview-markdown">
      <ReactMarkdown
        rehypePlugins={PREVIEW_MARKDOWN_REHYPE_PLUGINS}
        remarkPlugins={MARKDOWN_REMARK_PLUGINS}
        components={components as any}
      >
        {processedText || "_File is empty._"}
      </ReactMarkdown>
    </div>
  );
}

function PreviewText(props: { text: string; filePath: string; anchor: string; jumpToken: number }) {
  const normalizedAnchor = useMemo(() => normalizeMarkdownAnchor(props.anchor), [props.anchor]);
  const targetLine = useMemo(() => parseLineAnchor(normalizedAnchor), [normalizedAnchor]);
  const lines = useMemo(() => props.text.split(/\r?\n/g), [props.text]);
  const targetLineRef = useRef<HTMLSpanElement | null>(null);
  const rootRef = useRef<HTMLPreElement | null>(null);
  const alignedAnchorRef = useRef("");

  useEffect(() => {
    if (!targetLine || !targetLineRef.current || !rootRef.current) return;
    const target = targetLineRef.current;
    target.classList.remove("preview-text-line-hit");
    // Force class reflow so repeated clicks can re-trigger highlight animation.
    void target.offsetWidth;
    target.classList.add("preview-text-line-hit");
    const requestKey = `${props.filePath}#${normalizedAnchor}`;
    const repeatedJump = alignedAnchorRef.current === requestKey;
    alignedAnchorRef.current = requestKey;
    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    return keepPreviewTargetAligned({
      root: rootRef.current,
      target,
      block: "center",
      behavior: repeatedJump && !prefersReducedMotion ? "smooth" : "auto",
      stabilize: !repeatedJump
    });
  }, [normalizedAnchor, props.filePath, props.jumpToken, props.text, targetLine]);

  if (!targetLine) {
    return <pre className="preview-text">{props.text || "(File is empty)"}</pre>;
  }

  return (
    <pre ref={rootRef} className="preview-text preview-text-with-lines">
      {(lines.length > 0 ? lines : [""]).map((line, index) => {
        const lineNo = index + 1;
        const isTarget = lineNo === targetLine;
        return (
          <span
            key={`line-${lineNo}`}
            className={isTarget ? "preview-text-line is-target" : "preview-text-line"}
            ref={isTarget ? targetLineRef : undefined}
          >
            <span className="preview-text-line-number">{lineNo}</span>
            <span className="preview-text-line-content">{line || " "}</span>
          </span>
        );
      })}
    </pre>
  );
}

export function PreviewWorkbenchPanel(props: {
  threadId: string;
  requestedFilePath?: string;
  requestNonce?: number;
  allowDownload?: boolean;
  externalArtifactMode?: boolean;
  workspaceFileId?: string;
  workspaceFileName?: string;
  workspaceFileMimeType?: string;
  workspaceApiBasePath?: string;
  workspaceFileReadOnly?: boolean;
}) {
  const { locale, t } = usePortalI18n();
  const requestedTarget = useMemo(
    () => splitPreviewTarget(asString(props.requestedFilePath)),
    [props.requestedFilePath]
  );
  const requestedFilePath = requestedTarget.filePath;
  const requestedAnchor = requestedTarget.anchor;
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [selectedAnchor, setSelectedAnchor] = useState("");
  const [anchorJumpToken, setAnchorJumpToken] = useState(0);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [textOffset, setTextOffset] = useState(0);
  const [textSearchDraft, setTextSearchDraft] = useState("");
  const [textSearch, setTextSearch] = useState("");
  const [tableSheet, setTableSheet] = useState("");
  const [tableRowOffset, setTableRowOffset] = useState(0);
  const [tableColumnOffset, setTableColumnOffset] = useState(0);
  const [workspaceVersions, setWorkspaceVersions] = useState<WorkspaceFileVersionApiRecord[]>([]);
  const [selectedWorkspaceVersionId, setSelectedWorkspaceVersionId] = useState("");
  const [restoringWorkspaceVersion, setRestoringWorkspaceVersion] = useState(false);
  const previewObjectUrlRef = useRef("");
  const xlsxPreviewRef = useRef<HTMLDivElement | null>(null);
  const pagedTextPreviewRef = useRef<HTMLPreElement | null>(null);
  const pagedTextTargetRef = useRef<HTMLSpanElement | null>(null);
  const fileCitationTarget = useMemo(
    () => parseCodexFileCitationPreviewAnchor(selectedAnchor),
    [selectedAnchor]
  );
  const xlsxCitationRange = useMemo(
    () => parseXlsxCellRange(fileCitationTarget?.range),
    [fileCitationTarget?.range]
  );
  const selectedTextTargetLine = useMemo(
    () => parseLineAnchor(normalizeMarkdownAnchor(selectedAnchor)),
    [selectedAnchor]
  );
  const selectedTextTargetOffset = selectedTextTargetLine
    ? Math.floor((selectedTextTargetLine - 1) / 200) * 200
    : 0;
  const navigatePreviewTarget = useCallback((target: { filePath: string; anchor: string }) => {
    const normalizedFilePath = normalizeFilePath(target.filePath);
    if (!normalizedFilePath) return;
    setSelectedFilePath(normalizedFilePath);
    setSelectedAnchor(normalizeMarkdownAnchor(target.anchor || ""));
    const targetLine = parseLineAnchor(normalizeMarkdownAnchor(target.anchor || ""));
    setTextOffset(targetLine ? Math.floor((targetLine - 1) / 200) * 200 : 0);
    setTextSearchDraft("");
    setTextSearch("");
    setTableSheet("");
    setTableRowOffset(0);
    setTableColumnOffset(0);
    setAnchorJumpToken((value) => value + 1);
  }, []);

  const currentPreviewObjectUrl = preview.status === "ready" ? preview.content.objectUrl : "";

  useEffect(() => {
    const previous = previewObjectUrlRef.current;
    if (previous && previous !== currentPreviewObjectUrl) {
      URL.revokeObjectURL(previous);
    }
    previewObjectUrlRef.current = currentPreviewObjectUrl;
  }, [currentPreviewObjectUrl]);

  useEffect(
    () => () => {
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
        previewObjectUrlRef.current = "";
      }
    },
    []
  );

  useEffect(() => {
    setSelectedFilePath("");
    setSelectedAnchor("");
    setTextOffset(0);
    setTextSearchDraft("");
    setTextSearch("");
    setTableSheet("");
    setTableRowOffset(0);
    setTableColumnOffset(0);
  }, [props.threadId]);

  useEffect(() => {
    if (!requestedFilePath) return;
    setSelectedFilePath(requestedFilePath);
    setSelectedAnchor(requestedAnchor);
    const targetLine = parseLineAnchor(normalizeMarkdownAnchor(requestedAnchor));
    setTextOffset(targetLine ? Math.floor((targetLine - 1) / 200) * 200 : 0);
    setTextSearchDraft("");
    setTextSearch("");
    setTableSheet("");
    const citation = parseCodexFileCitationPreviewAnchor(requestedAnchor);
    const range = parseXlsxCellRange(citation?.range);
    setTableRowOffset(range ? Math.floor((range.startRow - 1) / 100) * 100 : 0);
    setTableColumnOffset(range ? Math.floor((range.startColumn - 1) / 40) * 40 : 0);
    setAnchorJumpToken((value) => value + 1);
  }, [props.requestNonce, requestedAnchor, requestedFilePath]);

  useEffect(() => {
    const fileId = String(props.workspaceFileId || "").trim();
    if (!fileId) {
      setWorkspaceVersions([]);
      setSelectedWorkspaceVersionId("");
      return;
    }
    let cancelled = false;
    const workspaceApiBasePath = props.workspaceApiBasePath || "/api/portal/workspace";
    void api<{ versions: WorkspaceFileVersionApiRecord[] }>(
      `${workspaceApiBasePath}/files/${encodeURIComponent(fileId)}/versions`
    )
      .then((out) => {
        if (cancelled) return;
        setWorkspaceVersions(Array.isArray(out.versions) ? out.versions : []);
        setSelectedWorkspaceVersionId("");
      })
      .catch(() => {
        if (!cancelled) setWorkspaceVersions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [props.workspaceApiBasePath, props.workspaceFileId]);

  const activeFile = useMemo(() => {
    if (String(props.workspaceFileId || "").trim()) {
      const displayName = String(props.workspaceFileName || "").trim() || t("files.untitled");
      return {
        filePath: displayName,
        displayName,
        mimeType: String(props.workspaceFileMimeType || "").trim(),
        source: "file_change" as const,
        updatedAt: Date.now()
      };
    }
    const normalizedSelected = normalizeFilePath(selectedFilePath);
    if (!normalizedSelected) return null;
    return {
      filePath: normalizedSelected,
      displayName: fileNameFromPath(normalizedSelected),
      mimeType: "",
      source: "file_change" as const,
      updatedAt: Date.now()
    };
  }, [props.workspaceFileId, props.workspaceFileMimeType, props.workspaceFileName, selectedFilePath, t]);
  const activeFilePath = useMemo(() => normalizeFilePath(activeFile?.filePath || ""), [activeFile?.filePath]);
  const activeFileDisplayName = activeFile?.displayName || fileNameFromPath(activeFilePath);
  const activeFileMimeType = activeFile?.mimeType || "";
  const activeFileForKind = useMemo(
    (): ThreadFileRecord => ({
      filePath: activeFilePath,
      displayName: activeFileDisplayName,
      mimeType: activeFileMimeType,
      source: "file_change",
      updatedAt: 0
    }),
    [activeFileDisplayName, activeFileMimeType, activeFilePath]
  );

  useEffect(() => {
    let cancelled = false;
    let createdObjectUrl = "";

    const releaseObjectUrl = () => {
      if (createdObjectUrl) {
        URL.revokeObjectURL(createdObjectUrl);
        createdObjectUrl = "";
      }
    };

    const loadPreview = async () => {
      const workspaceFileId = String(props.workspaceFileId || "").trim();
      if (!activeFilePath) {
        setPreview({ status: "idle" });
        return;
      }
      const filePath = activeFilePath;
      const isKnowledgeSetFile = isKnowledgeSetFilePath(filePath);
      if (!workspaceFileId && !isKnowledgeSetFile && !props.threadId.trim()) {
        setPreview({ status: "idle" });
        return;
      }
      setPreview({ status: "loading" });
      try {
        let response: Response;
        let fileForKind = activeFileForKind;
        let downloadUrl = "";
        const extension = fileExtension(fileForKind.displayName || fileForKind.filePath);
        const structuredOptions: PreviewFetchOptions | undefined =
          EXCEL_EXTENSIONS.has(extension) || extension === "csv" || extension === "tsv"
            ? {
                mode: "table",
                params: {
                  sheet: tableSheet || fileCitationTarget?.sheet,
                  row_offset: tableRowOffset,
                  row_limit: 100,
                  column_offset: tableColumnOffset,
                  column_limit: 40
                }
              }
            : DRAWIO_EXTENSIONS.has(extension)
              ? { mode: "diagram" }
              : TEXT_LIKE_EXTENSIONS.has(extension) && !["md", "markdown", "html", "htm"].includes(extension)
                ? {
                    mode: "text",
                    params: { offset: textOffset, limit: 200, search: textSearch || undefined }
                  }
                : !extension
                  ? { mode: "auto" }
                  : undefined;
        if (workspaceFileId) {
          response = structuredOptions
            ? await fetchWorkspaceFileBlob(workspaceFileId, selectedWorkspaceVersionId || undefined, structuredOptions, props.workspaceApiBasePath)
            : await fetchPaginatedOfficePreview(
                supportsPaginatedOfficePreview(fileForKind.filePath, fileForKind.mimeType),
                (options) =>
                  fetchWorkspaceFileBlob(workspaceFileId, selectedWorkspaceVersionId || undefined, options, props.workspaceApiBasePath)
              );
          const query = new URLSearchParams({ disposition: "attachment" });
          if (selectedWorkspaceVersionId) query.set("version_id", selectedWorkspaceVersionId);
          downloadUrl = `${apiBase()}${props.workspaceApiBasePath || "/api/portal/workspace"}/files/${encodeURIComponent(workspaceFileId)}/content?${query.toString()}`;
        } else if (isKnowledgeSetFile) {
          response = structuredOptions
            ? await fetchPortalResourceFileBlob(filePath, structuredOptions)
            : await fetchPaginatedOfficePreview(
                supportsPaginatedOfficePreview(fileForKind.filePath, fileForKind.mimeType),
                (options) => fetchPortalResourceFileBlob(filePath, options)
              );
        } else if (props.externalArtifactMode) {
          const resolved = await resolveThreadArtifact(props.threadId, filePath);
          if (resolved.artifact.preview_status !== "ready") {
            throw new Error(resolved.artifact.blocked_reason || t("preview.blocked"));
          }
          fileForKind = {
            ...fileForKind,
            filePath: resolved.artifact.relative_path || fileForKind.filePath,
            displayName: resolved.artifact.display_name || fileForKind.displayName,
            mimeType: resolved.artifact.mime_type || fileForKind.mimeType
          };
          if (resolved.policy.download_enabled && resolved.artifact.download_status === "ready") {
            downloadUrl =
              buildPreviewFileContentUrl(props.threadId, fileForKind.filePath, {
                artifactMode: true,
                disposition: "attachment"
              }) || "";
          }
          response = structuredOptions
            ? await fetchThreadArtifactFileBlob(props.threadId, filePath, "inline", structuredOptions)
            : await fetchPaginatedOfficePreview(
                supportsPaginatedOfficePreview(fileForKind.filePath, fileForKind.mimeType),
                (options) => fetchThreadArtifactFileBlob(props.threadId, filePath, "inline", options)
              );
        } else {
          response = structuredOptions
            ? await fetchThreadFileBlob(props.threadId, filePath, structuredOptions)
            : await fetchPaginatedOfficePreview(
                supportsPaginatedOfficePreview(fileForKind.filePath, fileForKind.mimeType),
                (options) => fetchThreadFileBlob(props.threadId, filePath, options)
              );
        }
        const responseContentType = response.headers.get("content-type") || "";
        if (responseContentType.includes("application/json")) {
          const payload = await response.json() as TextPreviewPayload | TablePreviewPayload;
          if (!cancelled && payload.kind === "text") {
            setPreview({
              status: "ready",
              content: { kind: "paged-text", data: payload, objectUrl: "", ...(downloadUrl ? { downloadUrl } : {}) }
            });
          } else if (!cancelled && payload.kind === "table") {
            setTableSheet(payload.selectedSheet);
            setPreview({
              status: "ready",
              content: { kind: "paged-table", data: payload, objectUrl: "", ...(downloadUrl ? { downloadUrl } : {}) }
            });
          }
          return;
        }
        const blob = await response.blob();
        createdObjectUrl = URL.createObjectURL(blob);
        const kind = resolvePreviewKind(fileForKind, response.headers.get("content-type") || blob.type || "");
        const contentBase = () => ({
          objectUrl: createdObjectUrl,
          ...(downloadUrl ? { downloadUrl } : {})
        });

        if (kind === "image") {
          if (!cancelled) {
            setPreview({
              status: "ready",
              content: {
                kind: "image",
                ...contentBase()
              }
            });
            createdObjectUrl = "";
          }
          return;
        }

        if (kind === "pdf") {
          if (!cancelled) {
            setPreview({
              status: "ready",
              content: {
                kind: "pdf",
                ...contentBase()
              }
            });
            createdObjectUrl = "";
          }
          return;
        }

        if (kind === "html") {
          const html = await blob.text();
          if (!cancelled) {
            setPreview({
              status: "ready",
              content: {
                kind: "html",
                html,
                ...contentBase()
              }
            });
            createdObjectUrl = "";
          }
          return;
        }

        if (kind === "text") {
          const text = await blob.text();
          const isMarkdown = ["md", "markdown"].includes(fileExtension(filePath));
          if (!cancelled) {
            setPreview({
              status: "ready",
              content: isMarkdown
                ? {
                    kind: "markdown",
                    text,
                    ...contentBase(),
                    filePath
                  }
                : {
                    kind: "text",
                    text,
                    ...contentBase()
                  }
            });
            createdObjectUrl = "";
          }
          return;
        }

        if (kind === "docx") {
          const html = await convertDocxToHtml(await blob.arrayBuffer());
          if (!cancelled) {
            setPreview({
              status: "ready",
              content: {
                kind: "docx",
                html,
                ...contentBase()
              }
            });
            createdObjectUrl = "";
          }
          return;
        }

        if (kind === "xlsx") {
          const sheets = await convertXlsxToSheets(await blob.arrayBuffer(), fileCitationTarget?.sheet);
          if (!cancelled) {
            setPreview({
              status: "ready",
              content: {
                kind: "xlsx",
                sheets,
                ...contentBase()
              }
            });
            createdObjectUrl = "";
          }
          return;
        }

        if (kind === "pptx") {
          const slides = await convertPptxToSlides(await blob.arrayBuffer());
          if (!cancelled) {
            setPreview({
              status: "ready",
              content: {
                kind: "pptx",
                slides,
                ...contentBase()
              }
            });
            createdObjectUrl = "";
          }
          return;
        }

        if (!cancelled) {
          setPreview({
            status: "ready",
            content: {
              kind: "unsupported",
              ...contentBase(),
              reason: t("preview.unsupported")
            }
          });
          createdObjectUrl = "";
        }
      } catch (error) {
        releaseObjectUrl();
        if (!cancelled) {
          setPreview({
            status: "error",
            message: error instanceof Error ? error.message : t("preview.failed")
          });
        }
      }
    };

    void loadPreview();

    return () => {
      cancelled = true;
      releaseObjectUrl();
    };
  }, [
    activeFileForKind,
    activeFilePath,
    fileCitationTarget?.sheet,
    props.externalArtifactMode,
    props.threadId,
    props.workspaceApiBasePath,
    props.workspaceFileId,
    selectedWorkspaceVersionId,
    tableColumnOffset,
    tableRowOffset,
    tableSheet,
    textOffset,
    textSearch,
    t
  ]);

  const activePreview = preview.status === "ready" ? preview.content : null;
  const previewKind = activePreview?.kind ?? (activeFile ? preview.status : "idle");
  const downloadHref = activePreview?.downloadUrl || (!props.externalArtifactMode ? activePreview?.objectUrl : "");
  const latestWorkspaceVersionId = workspaceVersions[0]?.id || "";
  const selectedWorkspaceVersion =
    workspaceVersions.find((version) => version.id === selectedWorkspaceVersionId) ?? workspaceVersions[0];
  const fileCitationTargetLabel = fileCitationTarget?.pageNumber
    ? t("preview.targetPage", { page: fileCitationTarget.pageNumber })
    : fileCitationTarget?.sheet
      ? t("preview.targetSheetRange", {
          sheet: fileCitationTarget.sheet,
          range: fileCitationTarget.range || t("preview.entireSheet")
        })
      : "";

  useEffect(() => {
    if (
      activePreview?.kind !== "paged-text" ||
      !selectedTextTargetLine ||
      !pagedTextTargetRef.current ||
      !pagedTextPreviewRef.current
    ) {
      return;
    }
    const target = pagedTextTargetRef.current;
    target.classList.remove("preview-text-line-hit");
    void target.offsetWidth;
    target.classList.add("preview-text-line-hit");
    return keepPreviewTargetAligned({
      root: pagedTextPreviewRef.current,
      target,
      block: "center",
      behavior: "auto",
      stabilize: true
    });
  }, [activePreview, anchorJumpToken, selectedTextTargetLine]);

  useEffect(() => {
    if (activePreview?.kind !== "xlsx" || !fileCitationTarget?.sheet || !xlsxPreviewRef.current) return;
    const root = xlsxPreviewRef.current;
    const frame = window.requestAnimationFrame(() => {
      const targetCell = root.querySelector<HTMLElement>('[data-citation-target-start="true"]');
      const targetSheet = Array.from(root.querySelectorAll<HTMLElement>("[data-sheet-name]")).find(
        (element) => element.dataset.sheetName === fileCitationTarget.sheet
      );
      const target = targetCell || targetSheet;
      if (!target) return;
      alignPreviewTarget(target, targetCell ? "center" : "start", "smooth");
      const tableScroller = targetCell?.closest<HTMLElement>(".preview-table-wrap");
      if (targetCell && tableScroller) {
        const scrollerRect = tableScroller.getBoundingClientRect();
        const targetRect = targetCell.getBoundingClientRect();
        const targetLeft = tableScroller.scrollLeft + targetRect.left - scrollerRect.left;
        tableScroller.scrollTo({
          left: Math.max(0, targetLeft - Math.max(0, (tableScroller.clientWidth - targetRect.width) / 2)),
          behavior: "smooth"
        });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activePreview, anchorJumpToken, fileCitationTarget?.range, fileCitationTarget?.sheet]);

  const restoreWorkspaceVersion = async (requestedVersionId?: string) => {
    const fileId = String(props.workspaceFileId || "").trim();
    const versionId = String(requestedVersionId || selectedWorkspaceVersionId).trim();
    if (!fileId || !versionId || versionId === latestWorkspaceVersionId) return;
    setRestoringWorkspaceVersion(true);
    try {
      await api(
        `/api/portal/workspace/files/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(versionId)}/restore`,
        {
          method: "POST",
          json: props.threadId ? { thread_id: props.threadId } : {}
        }
      );
      const out = await api<{ versions: WorkspaceFileVersionApiRecord[] }>(
        `/api/portal/workspace/files/${encodeURIComponent(fileId)}/versions`
      );
      setWorkspaceVersions(Array.isArray(out.versions) ? out.versions : []);
      setSelectedWorkspaceVersionId("");
    } finally {
      setRestoringWorkspaceVersion(false);
    }
  };

  return (
    <div className="preview-workbench-shell">
      <section className="preview-workbench-viewer" data-preview-kind={previewKind}>
        {!activeFile ? (
          <div className="preview-workbench-placeholder">
            <FileSearch size={42} strokeWidth={1.5} />
            <span>{t("preview.openHint")}</span>
          </div>
        ) : (
          <>
            <header className="preview-viewer-head">
              <div className="preview-viewer-title-group">
                <h4>{activeFile.displayName}</h4>
                {props.workspaceFileId && selectedWorkspaceVersion ? (
                  <span className="preview-workspace-version-meta">
                    {t("workspace.versionLabel", { version: selectedWorkspaceVersion.version_no })}
                  </span>
                ) : null}
                {fileCitationTargetLabel && activePreview?.kind !== "xlsx" ? (
                  <span className="preview-viewer-anchor is-static">{fileCitationTargetLabel}</span>
                ) : selectedAnchor ? (
                  <button
                    type="button"
                    className="preview-viewer-anchor"
                    onClick={() => setAnchorJumpToken((value) => value + 1)}
                    title={t("preview.jumpTarget")}
                  >
                    {fileCitationTargetLabel || t("preview.targetSection", { section: selectedAnchor })}
                  </button>
                ) : null}
              </div>
              {props.allowDownload && activePreview && downloadHref ? (
                <div className="preview-viewer-actions">
                  <a href={downloadHref} download={!activePreview.downloadUrl ? activeFile.displayName : undefined}>
                    {t("preview.download")}
                  </a>
                </div>
              ) : null}
            </header>

            <div className="preview-viewer-body" data-preview-kind={previewKind}>
              {preview.status === "loading" ? (
                <div className="preview-loading">
                  <Spin size="small" />
                  <span>{t("preview.loading")}</span>
                </div>
              ) : null}

              {preview.status === "error" ? <div className="preview-error">{preview.message}</div> : null}

              {activePreview?.kind === "image" ? (
                <img className="preview-image" src={activePreview.objectUrl} alt={activeFile.displayName} />
              ) : null}

              {activePreview?.kind === "pdf" ? (
                <iframe
                  className="preview-iframe"
                  src={
                    fileCitationTarget?.pageNumber
                      ? `${activePreview.objectUrl}#page=${fileCitationTarget.pageNumber}`
                      : activePreview.objectUrl
                  }
                  title={activeFile.displayName}
                />
              ) : null}

              {activePreview?.kind === "html" || activePreview?.kind === "docx" ? (
                <iframe
                  className="preview-iframe"
                  title={activeFile.displayName}
                  sandbox={activePreview.kind === "html" ? "allow-scripts" : ""}
                  referrerPolicy="no-referrer"
                  srcDoc={
                    activePreview.kind === "html"
                      ? prepareInteractiveHtmlPreview(
                          activePreview.html || `<p>${t("preview.documentEmpty")}</p>`
                        )
                      : activePreview.html || `<p>${t("preview.documentEmpty")}</p>`
                  }
                />
              ) : null}

              {activePreview?.kind === "text" ? (
                <PreviewText
                  text={activePreview.text}
                  filePath={activeFilePath}
                  anchor={selectedAnchor}
                  jumpToken={anchorJumpToken}
                />
              ) : null}

              {activePreview?.kind === "paged-text" ? (
                <div className="preview-paged-text">
                  <div className="preview-data-toolbar">
                    <form
                      className="preview-search"
                      onSubmit={(event) => {
                        event.preventDefault();
                        setTextOffset(0);
                        setTextSearch(textSearchDraft.trim());
                      }}
                    >
                      <Search size={15} aria-hidden="true" />
                      <input
                        value={textSearchDraft}
                        onChange={(event) => setTextSearchDraft(event.target.value)}
                        placeholder={locale === "zh-CN" ? "搜索文件" : "Search file"}
                        aria-label={locale === "zh-CN" ? "搜索文件" : "Search file"}
                      />
                      {textSearchDraft ? (
                        <button
                          type="button"
                          className="preview-icon-button"
                          title={locale === "zh-CN" ? "清除搜索" : "Clear search"}
                          onClick={() => {
                            setTextSearchDraft("");
                            setTextSearch("");
                            setTextOffset(selectedTextTargetOffset);
                          }}
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                      ) : null}
                    </form>
                    <span className="preview-data-status">
                      {activePreview.data.query
                        ? locale === "zh-CN"
                          ? `${activePreview.data.lines.length}${activePreview.data.matchesTruncated ? "+" : ""} 个匹配项`
                          : `${activePreview.data.lines.length}${activePreview.data.matchesTruncated ? "+" : ""} matches`
                        : locale === "zh-CN"
                          ? `第 ${activePreview.data.lines[0]?.number || 0}-${activePreview.data.lines.at(-1)?.number || 0} 行${activePreview.data.totalLinesKnown ? `，共 ${activePreview.data.totalLines} 行` : ""}`
                          : `Lines ${activePreview.data.lines[0]?.number || 0}-${activePreview.data.lines.at(-1)?.number || 0}${activePreview.data.totalLinesKnown ? ` of ${activePreview.data.totalLines}` : ""}`}
                    </span>
                    {!activePreview.data.query ? (
                      <div className="preview-pagination">
                        <button
                          type="button"
                          className="preview-icon-button"
                          disabled={!activePreview.data.hasPrevious}
                          title={locale === "zh-CN" ? "上一页" : "Previous page"}
                          onClick={() => setTextOffset(Math.max(0, activePreview.data.offset - activePreview.data.limit))}
                        >
                          <ChevronLeft size={16} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="preview-icon-button"
                          disabled={!activePreview.data.hasNext}
                          title={locale === "zh-CN" ? "下一页" : "Next page"}
                          onClick={() => setTextOffset(activePreview.data.offset + activePreview.data.limit)}
                        >
                          <ChevronRight size={16} aria-hidden="true" />
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <pre ref={pagedTextPreviewRef} className="preview-text preview-text-with-lines">
                    {activePreview.data.lines.length ? activePreview.data.lines.map((line) => (
                      <span
                        key={line.number}
                        ref={line.number === selectedTextTargetLine ? pagedTextTargetRef : undefined}
                        className={
                          line.number === selectedTextTargetLine
                            ? "preview-text-line is-target preview-text-line-hit"
                            : "preview-text-line"
                        }
                      >
                        <span className="preview-text-line-number">{line.number}</span>
                        <span>{line.text || " "}</span>
                      </span>
                    )) : (
                      <span className="preview-empty-result">
                        {locale === "zh-CN" ? "没有找到匹配内容" : "No matches found"}
                      </span>
                    )}
                  </pre>
                </div>
              ) : null}

              {activePreview?.kind === "markdown" ? (
                <PreviewMarkdown
                  text={activePreview.text}
                  filePath={activePreview.filePath}
                  threadId={props.threadId}
                  artifactMode={props.externalArtifactMode}
                  anchor={selectedAnchor}
                  jumpToken={anchorJumpToken}
                  onNavigate={navigatePreviewTarget}
                />
              ) : null}

              {activePreview?.kind === "xlsx" ? (
                <div ref={xlsxPreviewRef} className="preview-sheet-list">
                  {activePreview.sheets.map((sheet) => (
                    <section
                      key={sheet.name}
                      className={
                        sheet.name === fileCitationTarget?.sheet
                          ? "preview-sheet-card is-citation-target"
                          : "preview-sheet-card"
                      }
                      data-sheet-name={sheet.name}
                    >
                      <h5>{sheet.name}</h5>
                      <div className="preview-table-wrap">
                        <table>
                          <tbody>
                            {sheet.rows.map((row, rowIndex) => (
                              <tr key={`${sheet.name}-row-${rowIndex}`}>
                                {row.map((cell, cellIndex) => {
                                  const rowNumber = rowIndex + 1;
                                  const columnNumber = cellIndex + 1;
                                  const isTargetCell =
                                    sheet.name === fileCitationTarget?.sheet &&
                                    cellIsInsideRange(rowNumber, columnNumber, xlsxCitationRange);
                                  const isTargetStart =
                                    isTargetCell &&
                                    rowNumber === xlsxCitationRange?.startRow &&
                                    columnNumber === xlsxCitationRange?.startColumn;
                                  return (
                                    <td
                                      key={`${sheet.name}-${rowIndex}-${cellIndex}`}
                                      className={isTargetCell ? "is-citation-target" : undefined}
                                      data-citation-target-start={isTargetStart ? "true" : undefined}
                                    >
                                      {cell}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  ))}
                </div>
              ) : null}

              {activePreview?.kind === "paged-table" ? (
                <div className="preview-paged-table">
                  <div className="preview-data-toolbar">
                    <label className="preview-sheet-select">
                      <span>{locale === "zh-CN" ? "工作表" : "Sheet"}</span>
                      <select
                        value={activePreview.data.selectedSheet}
                        onChange={(event) => {
                          setTableSheet(event.target.value);
                          setTableRowOffset(0);
                          setTableColumnOffset(0);
                        }}
                      >
                        {activePreview.data.sheets.map((sheet) => (
                          <option key={sheet.name} value={sheet.name}>
                            {sheet.name} ({sheet.rowCount.toLocaleString()} × {sheet.columnCount.toLocaleString()})
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="preview-data-status">
                      {locale === "zh-CN"
                        ? `当前仅加载第 ${activePreview.data.rowOffset + 1}-${Math.min(activePreview.data.totalRows, activePreview.data.rowOffset + activePreview.data.rows.length)} 行、第 ${activePreview.data.columnOffset + 1}-${Math.min(activePreview.data.totalColumns, activePreview.data.columnOffset + activePreview.data.columnLimit)} 列；共 ${activePreview.data.totalRows} 行、${activePreview.data.totalColumns} 列`
                        : `Partial view: rows ${activePreview.data.rowOffset + 1}-${Math.min(activePreview.data.totalRows, activePreview.data.rowOffset + activePreview.data.rows.length)} and columns ${activePreview.data.columnOffset + 1}-${Math.min(activePreview.data.totalColumns, activePreview.data.columnOffset + activePreview.data.columnLimit)} of ${activePreview.data.totalRows} rows and ${activePreview.data.totalColumns} columns`}
                    </span>
                    <div className="preview-pagination preview-table-pagination">
                      <button
                        type="button"
                        className="preview-icon-button"
                        disabled={!activePreview.data.hasPreviousColumns}
                        title={locale === "zh-CN" ? "前一组列" : "Previous columns"}
                        onClick={() => setTableColumnOffset(Math.max(0, activePreview.data.columnOffset - activePreview.data.columnLimit))}
                      >
                        <ChevronLeft size={16} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="preview-icon-button"
                        disabled={!activePreview.data.hasNextColumns}
                        title={locale === "zh-CN" ? "后一组列" : "Next columns"}
                        onClick={() => setTableColumnOffset(activePreview.data.columnOffset + activePreview.data.columnLimit)}
                      >
                        <ChevronRight size={16} aria-hidden="true" />
                      </button>
                      <span className="preview-pagination-divider" />
                      <button
                        type="button"
                        className="preview-icon-button"
                        disabled={!activePreview.data.hasPreviousRows}
                        title={locale === "zh-CN" ? "上一页" : "Previous rows"}
                        onClick={() => setTableRowOffset(Math.max(0, activePreview.data.rowOffset - activePreview.data.rowLimit))}
                      >
                        <ChevronLeft size={16} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="preview-icon-button"
                        disabled={!activePreview.data.hasNextRows}
                        title={locale === "zh-CN" ? "下一页" : "Next rows"}
                        onClick={() => setTableRowOffset(activePreview.data.rowOffset + activePreview.data.rowLimit)}
                      >
                        <ChevronRight size={16} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <div className="preview-table-wrap preview-table-window">
                    <table>
                      <thead>
                        <tr>
                          <th className="preview-table-corner" />
                          {Array.from(
                            { length: Math.min(activePreview.data.columnLimit, Math.max(0, activePreview.data.totalColumns - activePreview.data.columnOffset)) },
                            (_, index) => (
                              <th key={index}>{xlsxColumnLabel(activePreview.data.columnOffset + index)}</th>
                            )
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {activePreview.data.rows.map((row, rowIndex) => (
                          <tr key={activePreview.data.rowOffset + rowIndex}>
                            <th>{activePreview.data.rowOffset + rowIndex + 1}</th>
                            {row.map((cell, cellIndex) => {
                              const rowNumber = activePreview.data.rowOffset + rowIndex + 1;
                              const columnNumber = activePreview.data.columnOffset + cellIndex + 1;
                              const isTargetCell =
                                activePreview.data.selectedSheet === fileCitationTarget?.sheet &&
                                cellIsInsideRange(rowNumber, columnNumber, xlsxCitationRange);
                              return (
                                <td key={cellIndex} className={isTargetCell ? "is-citation-target" : undefined}>
                                  {cell}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {activePreview?.kind === "pptx" ? (
                <div className="preview-slide-list">
                  {activePreview.slides.map((slide) => (
                    <article key={slide.title} className="preview-slide-card">
                      <h5>{slide.title}</h5>
                      <ol>
                        {slide.lines.map((line, lineIndex) => (
                          <li key={`${slide.title}-${lineIndex}`}>{line}</li>
                        ))}
                      </ol>
                    </article>
                  ))}
                </div>
              ) : null}

              {activePreview?.kind === "unsupported" ? (
                <div className="preview-unsupported">{activePreview.reason}</div>
              ) : null}
            </div>
            {props.workspaceFileId && workspaceVersions.length > 0 ? (
              <section className="preview-version-history" aria-label={t("workspace.versionHistory")}>
                <header>
                  <h5>{t("workspace.versionHistory")}</h5>
                  <span>{t("workspace.versionCount", { count: workspaceVersions.length })}</span>
                </header>
                <div className="preview-version-list">
                  {workspaceVersions.map((version, index) => {
                    const current = index === 0;
                    const selected =
                      current ? !selectedWorkspaceVersionId : selectedWorkspaceVersionId === version.id;
                    return (
                      <article key={version.id} className={selected ? "preview-version-row is-selected" : "preview-version-row"}>
                        <button
                          type="button"
                          className="preview-version-main"
                          onClick={() => setSelectedWorkspaceVersionId(current ? "" : version.id)}
                        >
                          <strong>{t("workspace.versionLabel", { version: version.version_no })}</strong>
                          <span>
                            {current
                              ? t("workspace.currentVersion")
                              : formatWorkspaceVersionDate(version.created_at, locale)}
                          </span>
                        </button>
                        {!props.workspaceFileReadOnly && !current ? (
                          <Button
                            type="link"
                            size="small"
                            loading={restoringWorkspaceVersion && selectedWorkspaceVersionId === version.id}
                            onClick={() => void restoreWorkspaceVersion(version.id)}
                          >
                            {t("workspace.restoreVersion")}
                          </Button>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
