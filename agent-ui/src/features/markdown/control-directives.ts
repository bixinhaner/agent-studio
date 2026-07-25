const INLINE_VIS_DIRECTIVE_PATTERN =
  /^\s*::codex-inline-vis\{\s*file\s*=\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^}\s]+)\s*\}\s*$/;
const INLINE_VIS_DIRECTIVE_PREFIX_PATTERN = /^\s*::codex-inline-vis(?:\{|$)/;
const INLINE_VIS_FILE_PATTERN =
  /^\s*::codex-inline-vis\{\s*file\s*=\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^}\s]+)\s*\}\s*$/;
const FENCE_PATTERN = /^\s*(`{3,}|~{3,})(.*)$/;

type MarkdownFence = {
  marker: "`" | "~";
  length: number;
};

function splitMarkdownLines(text: string): Array<{ content: string; ending: string }> {
  const lines: Array<{ content: string; ending: string }> = [];
  const pattern = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (!match[0]) break;
    lines.push({ content: match[1], ending: match[2] });
  }
  return lines;
}

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

export function stripAssistantControlDirectives(text: string): string {
  if (!text.includes("::codex-inline-vis")) return text;

  let fence: MarkdownFence | null = null;
  let output = "";
  for (const line of splitMarkdownLines(text)) {
    const activeFence = fence;
    fence = nextFence(line.content, fence);

    const isDirective =
      !activeFence &&
      (INLINE_VIS_DIRECTIVE_PATTERN.test(line.content) ||
        (!line.ending && INLINE_VIS_DIRECTIVE_PREFIX_PATTERN.test(line.content)));
    if (!isDirective) {
      output += line.content + line.ending;
    }
  }
  return output;
}

function decodeDirectiveFile(rawValue: string): string {
  if (rawValue.startsWith('"')) {
    try {
      return JSON.parse(rawValue);
    } catch {
      return "";
    }
  }
  if (rawValue.startsWith("'") && rawValue.endsWith("'")) {
    return rawValue.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  }
  return rawValue;
}

export function expandAssistantControlDirectives(text: string): string {
  if (!text.includes("::codex-inline-vis")) return text;

  let fence: MarkdownFence | null = null;
  let output = "";
  for (const line of splitMarkdownLines(text)) {
    const activeFence = fence;
    fence = nextFence(line.content, fence);
    const match = !activeFence ? line.content.match(INLINE_VIS_FILE_PATTERN) : null;
    if (match) {
      const filePath = decodeDirectiveFile(match[1]).trim();
      if (filePath) {
        output += `[交互式可视化](/__codex-inline-vis?file=${encodeURIComponent(filePath)})${line.ending}`;
        continue;
      }
    }
    if (!activeFence && !line.ending && INLINE_VIS_DIRECTIVE_PREFIX_PATTERN.test(line.content)) {
      continue;
    }
    output += line.content + line.ending;
  }
  return output;
}
