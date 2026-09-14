export function normalizeComparablePath(value: string): string {
  return value
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\\ /g, " ")
    .replace(/\\(['"])/g, "$1")
    .replace(/\\\\/g, "/")
    .replace(/\/{2,}/g, "/");
}

/** Scan tool input without backtracking across arbitrary command/JSON text. */
export function collectAbsoluteSkillMdPaths(command: string): string[] {
  if (!command.toLowerCase().includes("/skill.md")) return [];
  const paths = new Set<string>();
  const add = (value: string) => {
    const normalized = normalizeComparablePath(value);
    if (/(^|\/)SKILL\.md$/i.test(normalized)) paths.add(normalized);
  };

  // Quotes delimit each search, so quoted paths (including spaces) stay intact.
  for (const pattern of [/"([^"\n]*\/SKILL\.md)"/gi, /'([^'\n]*\/SKILL\.md)'/gi]) {
    for (const match of command.matchAll(pattern)) add(match[1]);
  }

  const addToken = (start: number, end: number) => {
    if (start < 0) return;
    const token = command.slice(start, end);
    const suffix = token.toLowerCase().lastIndexOf("/skill.md");
    if (suffix > 0) add(token.slice(0, suffix + "/skill.md".length));
  };

  // The old (\\.|[^delimiter])+ pattern allowed a backslash to match both
  // branches. Missing suffixes caused exponential backtracking on the chat
  // event loop. Consume every character at most once, including escapes.
  let start = -1;
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (char === "\\" && i + 1 < command.length && !/[\r\n]/.test(command[i + 1])) {
      if (start < 0) start = i;
      i += 1;
    } else if (char === "\\" || /[\s'"`;|&<>]/.test(char)) {
      addToken(start, i);
      start = -1;
    } else if (start < 0) {
      start = i;
    }
  }
  addToken(start, command.length);
  return [...paths];
}
