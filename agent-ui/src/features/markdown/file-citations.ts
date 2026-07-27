const FILE_CITATION_PREFIX = ":codex-file-citation{";
const FILE_CITATION_LINK_PATH = "/__codex-file-citation";
const FENCE_PATTERN = /^\s*(`{3,}|~{3,})(.*)$/;
const UPLOAD_PREFIX_PATTERN = /^\d{10,}-[a-f0-9]{8,}-/i;

type MarkdownFence = {
  marker: "`" | "~";
  length: number;
};

export type CodexFileCitation = {
  id: number;
  key: string;
  path: string;
  previewPath: string;
  displayName: string;
  artifactKind: string;
  pageNumber?: number;
  sheet?: string;
  range?: string;
};

export type CodexFileCitationGroup = {
  path: string;
  previewPath: string;
  displayName: string;
  artifactKind: string;
  citations: CodexFileCitation[];
};

export type CodexFileCitationProjection = {
  markdown: string;
  citations: CodexFileCitation[];
  groups: CodexFileCitationGroup[];
};

export type CodexFileCitationLocale = "en" | "zh";

export type CodexFileCitationPreviewTarget = {
  pageNumber?: number;
  sheet?: string;
  range?: string;
};

function nextFence(line: string, current: MarkdownFence | null): MarkdownFence | null {
  const match = line.match(FENCE_PATTERN);
  if (!match) return current;

  const fence = match[1];
  const marker = fence[0] as "`" | "~";
  if (!current) {
    return { marker, length: fence.length };
  }
  if (marker === current.marker && fence.length >= current.length && match[2].trim() === "") {
    return null;
  }
  return current;
}

function parseDirectiveAttributes(value: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([a-zA-Z_][\w-]*)\s*=\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s}]+)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    const key = match[1];
    const rawValue = match[2];
    if (rawValue.startsWith('"')) {
      try {
        attributes[key] = JSON.parse(rawValue);
      } catch {
        attributes[key] = "";
      }
    } else if (rawValue.startsWith("'") && rawValue.endsWith("'")) {
      attributes[key] = rawValue.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, "\\");
    } else {
      attributes[key] = rawValue;
    }
  }
  return attributes;
}

function findDirectiveEnd(value: string, start: number): number {
  let quote = "";
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "}") return index;
  }
  return -1;
}

function inlineCodeRunLength(value: string, index: number): number {
  if (value[index] !== "`") return 0;
  let end = index;
  while (value[end] === "`") end += 1;
  return end - index;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").trim();
}

function fileNameFromPath(value: string): string {
  const normalized = normalizePath(value);
  const fileName = normalized.split("/").filter(Boolean).pop() || normalized;
  return fileName.replace(UPLOAD_PREFIX_PATTERN, "");
}

function workspaceRelativePreviewPath(value: string): string {
  const normalized = normalizePath(value);
  const threadWorkspaceMatch = normalized.match(/\/thread-[^/]+\/(.+)$/);
  if (threadWorkspaceMatch?.[1]) return threadWorkspaceMatch[1];

  const uploadPathIndex = normalized.indexOf("/.agent-studio/");
  if (uploadPathIndex >= 0) return normalized.slice(uploadPathIndex + 1);
  return normalized;
}

function positiveInteger(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function citationKey(input: Omit<CodexFileCitation, "id" | "key">): string {
  return [
    input.previewPath.toLowerCase(),
    input.artifactKind.toLowerCase(),
    input.pageNumber || "",
    input.sheet || "",
    input.range || ""
  ].join("\u0000");
}

function parseCitation(
  rawAttributes: string,
  id: number
): CodexFileCitation | null {
  const attributes = parseDirectiveAttributes(rawAttributes);
  const path = normalizePath(attributes.path || "");
  if (!path) return null;

  const artifactKind = (attributes.artifact_kind || "file").trim().toLowerCase();
  const previewPath = workspaceRelativePreviewPath(path);
  const base = {
    id,
    path,
    previewPath,
    displayName: fileNameFromPath(path),
    artifactKind,
    pageNumber: positiveInteger(attributes.page_number || ""),
    sheet: (attributes.sheet || "").trim() || undefined,
    range: (attributes.range || "").trim() || undefined
  };
  return {
    ...base,
    key: citationKey(base)
  };
}

function markdownEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/\[/g, "&#91;")
    .replace(/\]/g, "&#93;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\`*_])/g, "\\$1");
}

function locationLabel(citation: CodexFileCitation, locale: CodexFileCitationLocale): string {
  if (citation.pageNumber) {
    return locale === "zh" ? `第 ${citation.pageNumber} 页` : `p. ${citation.pageNumber}`;
  }
  if (citation.sheet && citation.range) return `${citation.sheet} · ${citation.range}`;
  if (citation.sheet) return citation.sheet;
  if (citation.range) return citation.range;
  return locale === "zh" ? "文件" : "File";
}

export function buildCodexFileCitationHref(citation: CodexFileCitation): string {
  const query = new URLSearchParams({
    path: citation.previewPath,
    artifact_kind: citation.artifactKind,
    ref: String(citation.id)
  });
  if (citation.pageNumber) query.set("page_number", String(citation.pageNumber));
  if (citation.sheet) query.set("sheet", citation.sheet);
  if (citation.range) query.set("range", citation.range);
  return `${FILE_CITATION_LINK_PATH}?${query.toString()}`;
}

export function parseCodexFileCitationHref(href: string): CodexFileCitation | null {
  try {
    const parsed = new URL(href, "https://agent-studio.invalid");
    if (parsed.pathname !== FILE_CITATION_LINK_PATH) return null;
    const previewPath = normalizePath(parsed.searchParams.get("path") || "");
    if (!previewPath) return null;

    const id = positiveInteger(parsed.searchParams.get("ref") || "") || 1;
    const base = {
      id,
      path: previewPath,
      previewPath,
      displayName: fileNameFromPath(previewPath),
      artifactKind: (parsed.searchParams.get("artifact_kind") || "file").trim().toLowerCase(),
      pageNumber: positiveInteger(parsed.searchParams.get("page_number") || ""),
      sheet: (parsed.searchParams.get("sheet") || "").trim() || undefined,
      range: (parsed.searchParams.get("range") || "").trim() || undefined
    };
    return {
      ...base,
      key: citationKey(base)
    };
  } catch {
    return null;
  }
}

export function buildCodexFileCitationPreviewAnchor(
  citation: Pick<CodexFileCitation, "pageNumber" | "sheet" | "range">
): string {
  const query = new URLSearchParams();
  if (citation.pageNumber) query.set("page_number", String(citation.pageNumber));
  if (citation.sheet) query.set("sheet", citation.sheet);
  if (citation.range) query.set("range", citation.range);
  const suffix = query.toString();
  return suffix ? `codex-file-citation?${suffix}` : "";
}

export function parseCodexFileCitationPreviewAnchor(anchor: string): CodexFileCitationPreviewTarget | null {
  const normalized = anchor.trim().replace(/^#+/, "");
  if (!normalized.startsWith("codex-file-citation")) return null;
  const queryIndex = normalized.indexOf("?");
  const query = new URLSearchParams(queryIndex >= 0 ? normalized.slice(queryIndex + 1) : "");
  const pageNumber = positiveInteger(query.get("page_number") || "");
  const sheet = (query.get("sheet") || "").trim() || undefined;
  const range = (query.get("range") || "").trim() || undefined;
  return pageNumber || sheet || range ? { pageNumber, sheet, range } : null;
}

export function codexFileCitationPreviewPath(citation: CodexFileCitation): string {
  const anchor = buildCodexFileCitationPreviewAnchor(citation);
  return anchor ? `${citation.previewPath}#${anchor}` : citation.previewPath;
}

function sourceSummaryMarkdown(
  groups: CodexFileCitationGroup[],
  locale: CodexFileCitationLocale
): string {
  if (groups.length === 0) return "";
  const locationCount = groups.reduce((total, group) => total + group.citations.length, 0);
  const title =
    locale === "zh"
      ? `上传文件引用 · ${groups.length} 个文件 / ${locationCount} 个位置`
      : `Uploaded file references · ${groups.length} ${groups.length === 1 ? "file" : "files"} / ${locationCount} ${
          locationCount === 1 ? "location" : "locations"
        }`;

  const lines = groups.map((group) => {
    const links = group.citations.map((citation) => {
      const label = `${citation.id} · ${locationLabel(citation, locale)}`;
      return `[${markdownEscape(label)}](<${buildCodexFileCitationHref(citation)}>)`;
    });
    return `- **${markdownEscape(group.displayName)}:** ${links.join(" · ")}`;
  });
  return `\n\n---\n\n**${title}**\n\n${lines.join("\n")}`;
}

export function projectCodexFileCitations(
  text: string,
  locale: CodexFileCitationLocale = "en"
): CodexFileCitationProjection {
  if (!text.includes(FILE_CITATION_PREFIX)) {
    return { markdown: text, citations: [], groups: [] };
  }

  const citationByKey = new Map<string, CodexFileCitation>();
  const groupsByPath = new Map<string, CodexFileCitationGroup>();
  const citations: CodexFileCitation[] = [];
  let fence: MarkdownFence | null = null;
  let markdown = "";
  let paragraphKeys = new Set<string>();

  const lines = text.split(/(\r\n|\n|\r)/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 2) {
    const line = lines[lineIndex] || "";
    const ending = lines[lineIndex + 1] || "";
    const activeFence = fence;
    fence = nextFence(line, fence);

    if (activeFence || !line.includes(FILE_CITATION_PREFIX)) {
      markdown += line + ending;
      if (!line.trim()) paragraphKeys = new Set<string>();
      continue;
    }

    let output = "";
    let index = 0;
    let inlineCodeLength = 0;
    while (index < line.length) {
      const codeRun = inlineCodeRunLength(line, index);
      if (codeRun > 0) {
        if (inlineCodeLength === 0) inlineCodeLength = codeRun;
        else if (codeRun === inlineCodeLength) inlineCodeLength = 0;
        output += line.slice(index, index + codeRun);
        index += codeRun;
        continue;
      }

      if (inlineCodeLength === 0 && line.startsWith(FILE_CITATION_PREFIX, index)) {
        const directiveEnd = findDirectiveEnd(line, index + FILE_CITATION_PREFIX.length);
        if (directiveEnd < 0) {
          break;
        }
        const rawAttributes = line.slice(index + FILE_CITATION_PREFIX.length, directiveEnd);
        const candidate = parseCitation(rawAttributes, citations.length + 1);
        if (candidate) {
          let citation = citationByKey.get(candidate.key);
          if (!citation) {
            citation = candidate;
            citationByKey.set(candidate.key, citation);
            citations.push(citation);
            const groupKey = citation.previewPath.toLowerCase();
            const group =
              groupsByPath.get(groupKey) ||
              {
                path: citation.path,
                previewPath: citation.previewPath,
                displayName: citation.displayName,
                artifactKind: citation.artifactKind,
                citations: []
              };
            group.citations.push(citation);
            groupsByPath.set(groupKey, group);
          }
          if (!paragraphKeys.has(citation.key)) {
            output += `[${citation.id}](<${buildCodexFileCitationHref(citation)}>)`;
            paragraphKeys.add(citation.key);
          }
        }
        index = directiveEnd + 1;
        continue;
      }

      output += line[index];
      index += 1;
    }
    markdown += output.trimEnd() + ending;
    if (!line.trim()) paragraphKeys = new Set<string>();
  }

  const groups = [...groupsByPath.values()];
  return {
    markdown: `${markdown.trimEnd()}${sourceSummaryMarkdown(groups, locale)}`,
    citations,
    groups
  };
}
