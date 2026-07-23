type Fence = {
  character: "`" | "~";
  length: number;
  start: number;
};

type ProtectedRange = {
  start: number;
  end: number;
};

function delimiterIsEscaped(text: string, index: number): boolean {
  let precedingBackslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    precedingBackslashes += 1;
  }
  return precedingBackslashes % 2 === 1;
}

function findClosingDelimiter(text: string, start: number, close: ")" | "]"): number {
  for (let cursor = start; cursor < text.length - 1; cursor += 1) {
    if (
      text[cursor] === "\\" &&
      text[cursor + 1] === close &&
      !delimiterIsEscaped(text, cursor)
    ) {
      return cursor;
    }
  }
  return -1;
}

function blankLineBefore(value: string): string {
  if (!value || /(?:^|\r?\n)[ \t]*\r?\n[ \t]*$/.test(value)) return "";
  if (/\r?\n[ \t]*$/.test(value)) return "\n";
  return "\n\n";
}

function blankLineAfter(value: string): string {
  if (!value || /^[ \t]*\r?\n[ \t]*\r?\n/.test(value)) return "";
  if (/^[ \t]*\r?\n/.test(value)) return "\n";
  return "\n\n";
}

function normalizePlainText(text: string, contextBefore = "", contextAfter = ""): string {
  let result = "";
  let cursor = 0;

  while (cursor < text.length - 1) {
    const isOpeningDelimiter =
      text[cursor] === "\\" &&
      (text[cursor + 1] === "(" || text[cursor + 1] === "[") &&
      !delimiterIsEscaped(text, cursor);

    if (!isOpeningDelimiter) {
      result += text[cursor];
      cursor += 1;
      continue;
    }

    const opening = text[cursor + 1];
    const closing = opening === "(" ? ")" : "]";
    const closingIndex = findClosingDelimiter(text, cursor + 2, closing);
    if (closingIndex < 0) {
      result += text[cursor];
      cursor += 1;
      continue;
    }

    const content = text.slice(cursor + 2, closingIndex);
    if (opening === "(") {
      result += `$${content}$`;
    } else {
      const displayContent = content.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
      const remainingText = text.slice(closingIndex + 2) + contextAfter;
      result += `${blankLineBefore(contextBefore + result)}$$\n${displayContent}\n$$${blankLineAfter(remainingText)}`;
    }
    cursor = closingIndex + 2;
  }

  return result + text.slice(cursor);
}

function backtickRunLength(text: string, index: number): number {
  let length = 0;
  while (text[index + length] === "`") length += 1;
  return length;
}

function findClosingBacktickRun(text: string, start: number, length: number): number {
  for (let cursor = start; cursor < text.length; cursor += 1) {
    if (text[cursor] !== "`") continue;
    const runLength = backtickRunLength(text, cursor);
    if (runLength === length) return cursor;
    cursor += runLength - 1;
  }
  return -1;
}

function normalizeOutsideInlineCode(text: string, contextBefore = "", contextAfter = ""): string {
  let result = "";
  let cursor = 0;

  while (cursor < text.length) {
    const openingIndex = text.indexOf("`", cursor);
    if (openingIndex < 0) {
      result += normalizePlainText(text.slice(cursor), contextBefore + result, contextAfter);
      break;
    }

    result += normalizePlainText(
      text.slice(cursor, openingIndex),
      contextBefore + result,
      text.slice(openingIndex) + contextAfter
    );
    const runLength = backtickRunLength(text, openingIndex);
    const closingIndex = findClosingBacktickRun(text, openingIndex + runLength, runLength);
    if (closingIndex < 0) {
      result += text.slice(openingIndex);
      break;
    }

    const codeEnd = closingIndex + runLength;
    result += text.slice(openingIndex, codeEnd);
    cursor = codeEnd;
  }

  return result;
}

function lineWithoutEnding(text: string): string {
  return text.replace(/\r?\n$/, "");
}

function openingFenceForLine(line: string, start: number): Fence | null {
  const match = /^ {0,3}(`{3,}|~{3,})/.exec(lineWithoutEnding(line));
  if (!match) return null;
  const marker = match[1];
  return {
    character: marker[0] as Fence["character"],
    length: marker.length,
    start
  };
}

function closesFence(line: string, fence: Fence): boolean {
  const escapedCharacter = fence.character === "`" ? "`" : "~";
  const pattern = new RegExp(`^ {0,3}${escapedCharacter}{${fence.length},}[ \\t]*$`);
  return pattern.test(lineWithoutEnding(line));
}

function fencedCodeRanges(text: string): ProtectedRange[] {
  const ranges: ProtectedRange[] = [];
  const lines = text.match(/.*(?:\r?\n|$)/g)?.filter(Boolean) ?? [];
  let offset = 0;
  let activeFence: Fence | null = null;

  for (const line of lines) {
    const lineStart = offset;
    offset += line.length;

    if (!activeFence) {
      activeFence = openingFenceForLine(line, lineStart);
      continue;
    }

    if (closesFence(line, activeFence)) {
      ranges.push({ start: activeFence.start, end: offset });
      activeFence = null;
    }
  }

  if (activeFence) {
    ranges.push({ start: activeFence.start, end: text.length });
  }

  return ranges;
}

/**
 * Converts standard LaTeX delimiters into the dollar delimiters supported by
 * remark-math, while preserving fenced and inline code verbatim.
 */
export function normalizeLatexDelimiters(text: string): string {
  const protectedRanges = fencedCodeRanges(text);
  if (protectedRanges.length === 0) return normalizeOutsideInlineCode(text);

  let result = "";
  let cursor = 0;
  for (const range of protectedRanges) {
    result += normalizeOutsideInlineCode(text.slice(cursor, range.start), result, text.slice(range.start));
    result += text.slice(range.start, range.end);
    cursor = range.end;
  }
  result += normalizeOutsideInlineCode(text.slice(cursor), result);
  return result;
}
