import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Spin } from "antd";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { apiBase, authHeaders, notifyAuthInvalidStatus } from "../../../lib/api";

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

type PptxSlidePreview = {
  title: string;
  lines: string[];
};

type PreviewContent =
  | { kind: "image"; objectUrl: string }
  | { kind: "pdf"; objectUrl: string }
  | { kind: "html"; html: string; objectUrl: string }
  | { kind: "text"; text: string; objectUrl: string }
  | { kind: "markdown"; text: string; objectUrl: string; filePath: string }
  | { kind: "docx"; html: string; objectUrl: string }
  | { kind: "xlsx"; sheets: XlsxSheetPreview[]; objectUrl: string }
  | { kind: "pptx"; slides: PptxSlidePreview[]; objectUrl: string }
  | { kind: "unsupported"; objectUrl: string; reason: string };

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

const TEXT_LIKE_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "jsonl",
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
  "log",
  "sql"
]);

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"]);
const WORD_EXTENSIONS = new Set(["doc", "docx"]);
const POWERPOINT_EXTENSIONS = new Set(["ppt", "pptx"]);
const EXCEL_EXTENSIONS = new Set(["xls", "xlsx"]);

const UPLOADED_FILE_TAG_PATTERN = /<uploaded_file\s+([^>]+)>/gi;
const UPLOADED_FILE_ATTR_PATTERN = /([a-zA-Z_][\w-]*)=("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s>]+)/g;

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

function isKnowledgeSetFilePath(filePath: string): boolean {
  const normalized = normalizeFilePath(filePath);
  return normalized.includes("/data/knowledge-sets/");
}

function buildPreviewFileContentUrl(threadId: string, filePath: string): string | null {
  const normalizedPath = splitPreviewTarget(filePath).filePath;
  if (!normalizedPath) return null;
  const query = new URLSearchParams({ path: normalizedPath });
  if (isKnowledgeSetFilePath(normalizedPath)) {
    return `${apiBase()}/api/portal/resources/files/content?${query.toString()}`;
  }
  if (!threadId.trim()) return null;
  return `${apiBase()}/api/threads/${encodeURIComponent(threadId.trim())}/files/content?${query.toString()}`;
}

function resolveMarkdownLinkedFilePath(baseFilePath: string, rawTarget: string): { filePath: string; anchor: string } | null {
  const target = rawTarget.trim();
  if (!target || target.startsWith("#") || /^(mailto|tel|javascript|data|blob):/i.test(target)) return null;

  if (isLikelyExternalUrl(target)) {
    try {
      const parsed = new URL(target, window.location.href);
      if (parsed.origin !== window.location.origin) return null;
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

async function fetchThreadFileBlob(threadId: string, filePath: string): Promise<Response> {
  const query = new URLSearchParams({ path: filePath });
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

async function fetchPortalResourceFileBlob(filePath: string): Promise<Response> {
  const query = new URLSearchParams({ path: filePath });
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

async function convertXlsxToSheets(arrayBuffer: ArrayBuffer): Promise<XlsxSheetPreview[]> {
  const xlsxModule = await import("xlsx");
  const workbook = xlsxModule.read(arrayBuffer, { type: "array" });
  const sheetNames = workbook.SheetNames.slice(0, 6);
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
  return text.replace(/<a\s+id=(?:"[^"]+"|'[^']+')[^>]*>\s*<\/a>/gi, "");
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
  const match = normalized.match(/^l(\d+)$/i);
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

function PreviewMarkdown(props: { text: string; filePath: string; threadId: string; anchor: string; jumpToken: number }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
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

    if (!target) return;
    root.querySelectorAll(".preview-markdown-anchor-hit").forEach((element) => {
      element.classList.remove("preview-markdown-anchor-hit");
    });
    target.classList.add("preview-markdown-anchor-hit");
    target.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [normalizedAnchor, processedText, props.jumpToken]);

  const components = useMemo(
    () => ({
      h1: createPreviewMarkdownHeading("h1"),
      h2: createPreviewMarkdownHeading("h2"),
      h3: createPreviewMarkdownHeading("h3"),
      h4: createPreviewMarkdownHeading("h4"),
      h5: createPreviewMarkdownHeading("h5"),
      h6: createPreviewMarkdownHeading("h6"),
      a: ({ href, children, className }: { href?: string; children?: ReactNode; className?: string }) => {
        if (!href) return <span className={className}>{children}</span>;
        const linkedFile = resolveMarkdownLinkedFilePath(props.filePath, href);
        const fileUrl = linkedFile ? buildPreviewFileContentUrl(props.threadId, linkedFile.filePath) : null;
        if (!linkedFile || !fileUrl) {
          return (
            <a className={className} href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          );
        }
        const resolvedHref = linkedFile.anchor ? `${fileUrl}#${encodeURIComponent(linkedFile.anchor)}` : fileUrl;
        return (
          <a
            className={className}
            href={resolvedHref}
            target="_blank"
            rel="noreferrer"
          >
            {children}
          </a>
        );
      },
      img: ({ src, alt, title, className }: { src?: string; alt?: string; title?: string; className?: string }) => {
        const linkedFile = src ? resolveMarkdownLinkedFilePath(props.filePath, src) : null;
        const imageUrl = linkedFile ? buildPreviewFileContentUrl(props.threadId, linkedFile.filePath) : src || "";
        if (!imageUrl) return null;
        return <img className={className} src={imageUrl} alt={alt || title || "Document image"} title={title} loading="lazy" />;
      }
    }),
    [props.filePath, props.threadId]
  );

  return (
    <div ref={rootRef} className="preview-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components as any}>
        {processedText || "_File is empty._"}
      </ReactMarkdown>
    </div>
  );
}

function PreviewText(props: { text: string; anchor: string; jumpToken: number }) {
  const normalizedAnchor = useMemo(() => normalizeMarkdownAnchor(props.anchor), [props.anchor]);
  const targetLine = useMemo(() => parseLineAnchor(normalizedAnchor), [normalizedAnchor]);
  const lines = useMemo(() => props.text.split(/\r?\n/g), [props.text]);
  const targetLineRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!targetLine || !targetLineRef.current) return;
    const target = targetLineRef.current;
    target.classList.remove("preview-text-line-hit");
    // Force class reflow so repeated clicks can re-trigger highlight animation.
    void target.offsetWidth;
    target.classList.add("preview-text-line-hit");
    target.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [targetLine, props.text, props.jumpToken]);

  if (!targetLine) {
    return <pre className="preview-text">{props.text || "(File is empty)"}</pre>;
  }

  return (
    <pre className="preview-text preview-text-with-lines">
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

export function PreviewWorkbenchPanel(props: { threadId: string; requestedFilePath?: string; requestNonce?: number }) {
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
  const previewObjectUrlRef = useRef("");

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
  }, [props.threadId]);

  useEffect(() => {
    if (!requestedFilePath) return;
    setSelectedFilePath(requestedFilePath);
    setSelectedAnchor(requestedAnchor);
    setAnchorJumpToken((value) => value + 1);
  }, [props.requestNonce, requestedAnchor, requestedFilePath]);

  const activeFile = useMemo(() => {
    const normalizedSelected = normalizeFilePath(selectedFilePath);
    if (!normalizedSelected) return null;
    return {
      filePath: normalizedSelected,
      displayName: fileNameFromPath(normalizedSelected),
      mimeType: "",
      source: "file_change" as const,
      updatedAt: Date.now()
    };
  }, [selectedFilePath]);
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
      if (!activeFilePath) {
        setPreview({ status: "idle" });
        return;
      }
      const filePath = activeFilePath;
      const isKnowledgeSetFile = isKnowledgeSetFilePath(filePath);
      if (!isKnowledgeSetFile && !props.threadId.trim()) {
        setPreview({ status: "idle" });
        return;
      }
      setPreview({ status: "loading" });
      try {
        const response = isKnowledgeSetFile
          ? await fetchPortalResourceFileBlob(filePath)
          : await fetchThreadFileBlob(props.threadId, filePath);
        const blob = await response.blob();
        createdObjectUrl = URL.createObjectURL(blob);
        const kind = resolvePreviewKind(activeFileForKind, response.headers.get("content-type") || blob.type || "");

        if (kind === "image") {
          if (!cancelled) {
            setPreview({
              status: "ready",
              content: {
                kind: "image",
                objectUrl: createdObjectUrl
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
                objectUrl: createdObjectUrl
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
                objectUrl: createdObjectUrl
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
                    objectUrl: createdObjectUrl,
                    filePath
                  }
                : {
                    kind: "text",
                    text,
                    objectUrl: createdObjectUrl
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
                objectUrl: createdObjectUrl
              }
            });
            createdObjectUrl = "";
          }
          return;
        }

        if (kind === "xlsx") {
          const sheets = await convertXlsxToSheets(await blob.arrayBuffer());
          if (!cancelled) {
            setPreview({
              status: "ready",
              content: {
                kind: "xlsx",
                sheets,
                objectUrl: createdObjectUrl
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
                objectUrl: createdObjectUrl
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
              objectUrl: createdObjectUrl,
              reason: "This file format cannot be rendered in the built-in preview."
            }
          });
          createdObjectUrl = "";
        }
      } catch (error) {
        releaseObjectUrl();
        if (!cancelled) {
          setPreview({
            status: "error",
            message: error instanceof Error ? error.message : "Failed to read file"
          });
        }
      }
    };

    void loadPreview();

    return () => {
      cancelled = true;
      releaseObjectUrl();
    };
  }, [activeFileForKind, activeFilePath, props.threadId]);

  const activePreview = preview.status === "ready" ? preview.content : null;

  return (
    <div className="preview-workbench-shell">
      <section className="preview-workbench-viewer">
        {!activeFile ? (
          <div className="preview-workbench-placeholder">Click "Preview" on a file card in the conversation to open it here.</div>
        ) : (
          <>
            <header className="preview-viewer-head">
              <div className="preview-viewer-title-group">
                <h4>{activeFile.displayName}</h4>
                {selectedAnchor ? (
                  <button
                    type="button"
                    className="preview-viewer-anchor"
                    onClick={() => setAnchorJumpToken((value) => value + 1)}
                    title="Jump to the target section again"
                  >
                    Target section: {selectedAnchor}
                  </button>
                ) : null}
              </div>
            </header>

            <div className="preview-viewer-body">
              {preview.status === "loading" ? (
                <div className="preview-loading">
                  <Spin size="small" />
                  <span>Loading preview...</span>
                </div>
              ) : null}

              {preview.status === "error" ? <div className="preview-error">{preview.message}</div> : null}

              {activePreview?.kind === "image" ? (
                <img className="preview-image" src={activePreview.objectUrl} alt={activeFile.displayName} />
              ) : null}

              {activePreview?.kind === "pdf" ? (
                <iframe className="preview-iframe" src={activePreview.objectUrl} title={activeFile.displayName} />
              ) : null}

              {activePreview?.kind === "html" || activePreview?.kind === "docx" ? (
                <iframe
                  className="preview-iframe"
                  title={activeFile.displayName}
                  sandbox=""
                  srcDoc={activePreview.html || "<p>Document is empty</p>"}
                />
              ) : null}

              {activePreview?.kind === "text" ? (
                <PreviewText text={activePreview.text} anchor={selectedAnchor} jumpToken={anchorJumpToken} />
              ) : null}

              {activePreview?.kind === "markdown" ? (
                <PreviewMarkdown
                  text={activePreview.text}
                  filePath={activePreview.filePath}
                  threadId={props.threadId}
                  anchor={selectedAnchor}
                  jumpToken={anchorJumpToken}
                />
              ) : null}

              {activePreview?.kind === "xlsx" ? (
                <div className="preview-sheet-list">
                  {activePreview.sheets.map((sheet) => (
                    <section key={sheet.name} className="preview-sheet-card">
                      <h5>{sheet.name}</h5>
                      <div className="preview-table-wrap">
                        <table>
                          <tbody>
                            {sheet.rows.map((row, rowIndex) => (
                              <tr key={`${sheet.name}-row-${rowIndex}`}>
                                {row.map((cell, cellIndex) => (
                                  <td key={`${sheet.name}-${rowIndex}-${cellIndex}`}>{cell}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  ))}
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
          </>
        )}
      </section>
    </div>
  );
}
