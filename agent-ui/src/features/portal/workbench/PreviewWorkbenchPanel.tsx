import { useEffect, useMemo, useRef, useState } from "react";
import { Spin } from "antd";
import { useAuiState } from "@assistant-ui/store";

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

function fileNameFromPath(filePath: string): string {
  const normalized = normalizeFilePath(filePath);
  if (!normalized) return "未命名文件";
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] || normalized;
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
    displayName: nextDisplayName || "未命名文件",
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
    let detail = `读取文件失败(${response.status})`;
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
    let detail = `读取资料集文件失败(${response.status})`;
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
    throw new Error("DOCX 解析器不可用");
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
      rows: rows.length > 0 ? rows : [["(空表)"]]
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
      lines: lines.length > 0 ? lines : ["(空白页)"]
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

export function PreviewWorkbenchPanel(props: { threadId: string; requestedFilePath?: string }) {
  const threadMessages = useAuiState((s) => s.thread.messages);
  const threadFiles = useMemo(() => collectThreadFiles(threadMessages), [threadMessages]);
  const [selectedFilePath, setSelectedFilePath] = useState("");
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
  }, [props.threadId]);

  useEffect(() => {
    const requested = normalizeFilePath(asString(props.requestedFilePath));
    if (!requested) return;
    setSelectedFilePath(requested);
  }, [props.requestedFilePath]);

  useEffect(() => {
    if (selectedFilePath) return;
    if (!threadFiles.length) return;
    setSelectedFilePath(threadFiles[0]!.filePath);
  }, [selectedFilePath, threadFiles]);

  const activeFile = useMemo(() => {
    const fromList = threadFiles.find((item) => item.filePath === selectedFilePath);
    if (fromList) return fromList;
    const normalizedSelected = normalizeFilePath(selectedFilePath);
    if (!normalizedSelected) return null;
    return {
      filePath: normalizedSelected,
      displayName: fileNameFromPath(normalizedSelected),
      mimeType: "",
      source: "file_change" as const,
      updatedAt: Date.now()
    };
  }, [selectedFilePath, threadFiles]);

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
      if (!activeFile) {
        setPreview({ status: "idle" });
        return;
      }
      const filePath = normalizeFilePath(activeFile.filePath);
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
        const kind = resolvePreviewKind(activeFile, response.headers.get("content-type") || blob.type || "");

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
          if (!cancelled) {
            setPreview({
              status: "ready",
              content: {
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
              reason: "当前文件格式无法在内置预览器中渲染，请使用新窗口打开或下载查看。"
            }
          });
          createdObjectUrl = "";
        }
      } catch (error) {
        releaseObjectUrl();
        if (!cancelled) {
          setPreview({
            status: "error",
            message: error instanceof Error ? error.message : "读取文件失败"
          });
        }
      }
    };

    void loadPreview();

    return () => {
      cancelled = true;
      releaseObjectUrl();
    };
  }, [activeFile, props.threadId]);

  const activePreview = preview.status === "ready" ? preview.content : null;

  return (
    <div className="preview-workbench-shell">
      <section className="preview-workbench-list">
        <h3>会话文件</h3>
        {!props.threadId.trim() ? (
          <p className="preview-workbench-empty">当前没有激活线程，无法展示文件。</p>
        ) : threadFiles.length === 0 ? (
          <p className="preview-workbench-empty">暂未检测到 AI 生成或上传的文件。</p>
        ) : (
          <div className="preview-workbench-items" role="list">
            {threadFiles.map((file) => (
              <button
                key={file.filePath}
                type="button"
                role="listitem"
                className={file.filePath === selectedFilePath ? "preview-file-item active" : "preview-file-item"}
                onClick={() => setSelectedFilePath(file.filePath)}
                title={file.filePath}
              >
                <span className="preview-file-name">{file.displayName}</span>
                <span className="preview-file-meta">
                  {file.source === "file_change" ? "AI 生成" : "附件上传"} · {formatUpdatedAt(file.updatedAt)}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="preview-workbench-viewer">
        {!activeFile ? (
          <div className="preview-workbench-placeholder">选择左侧文件后即可预览。</div>
        ) : (
          <>
            <header className="preview-viewer-head">
              <div className="preview-viewer-title-group">
                <h4>{activeFile.displayName}</h4>
                <p>{activeFile.filePath}</p>
              </div>
              {activePreview ? (
                <div className="preview-viewer-actions">
                  <a href={activePreview.objectUrl} target="_blank" rel="noreferrer">
                    新窗口打开
                  </a>
                  <a href={activePreview.objectUrl} download={activeFile.displayName}>
                    下载
                  </a>
                </div>
              ) : null}
            </header>

            <div className="preview-viewer-body">
              {preview.status === "loading" ? (
                <div className="preview-loading">
                  <Spin size="small" />
                  <span>正在加载预览...</span>
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
                  srcDoc={activePreview.html || "<p>文档为空</p>"}
                />
              ) : null}

              {activePreview?.kind === "text" ? (
                <pre className="preview-text">{activePreview.text || "(文件为空)"}</pre>
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
