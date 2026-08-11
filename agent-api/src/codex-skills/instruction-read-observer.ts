import path from "node:path";

import type { RuntimeStreamEvent } from "../live-runtime-session.js";
import type { CodexTurnSkill } from "../codex-runtime.js";

export type CodexInstructionReadKind = "skill" | "capability";
export type CodexInstructionReadTrigger = "selected" | "automatic";

export type CodexInstructionRead = {
  id: string;
  name: string;
  kind: CodexInstructionReadKind;
  trigger: CodexInstructionReadTrigger;
  readAt: string;
};

type CodexInstructionReadObserverOptions = {
  selectedSkills?: CodexTurnSkill[];
  now?: () => Date;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function serializedText(value: unknown): string | undefined {
  if (typeof value === "string") return trimOrUndefined(value);
  if (value === undefined || value === null) return undefined;
  try {
    return trimOrUndefined(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

function hasNonEmptyOutput(value: unknown): boolean {
  if (typeof value === "string") return Boolean(value.trim());
  if (Array.isArray(value)) return value.some(hasNonEmptyOutput);
  const record = asRecord(value);
  if (!record) return false;
  return [record.text, record.output, record.content, record.contentItems, record.result].some(hasNonEmptyOutput);
}

function normalizeComparablePath(value: string): string {
  return value
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\\ /g, " ")
    .replace(/\\(['"])/g, "$1")
    .replace(/\\\\/g, "/")
    .replace(/\/{2,}/g, "/");
}

function collectSkillMdPaths(command: string): string[] {
  const paths = new Set<string>();
  const add = (value: string | undefined) => {
    if (!value) return;
    const normalized = normalizeComparablePath(value);
    if (!/(^|\/)SKILL\.md$/i.test(normalized)) return;
    paths.add(normalized);
  };

  const quotedPatterns = [/"([^"\n]*\/SKILL\.md)"/gi, /'([^'\n]*\/SKILL\.md)'/gi];
  for (const pattern of quotedPatterns) {
    for (const match of command.matchAll(pattern)) add(match[1]);
  }
  for (const match of command.matchAll(/((?:\\.|[^\s'"`;|&<>])+\/SKILL\.md)/gi)) add(match[1]);
  return [...paths];
}

function collectRelativeSkillMdPath(command: string, argumentsValue: unknown): string | undefined {
  if (!/(?:^|[\s'"`;|&<>])SKILL\.md(?:$|[\s'"`;|&<>])/i.test(command)) return undefined;
  if (!/(?:^|[\s;'"&|])(?:cat|sed|head|tail|awk|perl|bat|less|more)\b[^\n]*\bSKILL\.md\b/i.test(command)) {
    return undefined;
  }
  const argumentRecord = asRecord(argumentsValue);
  const directWorkdir = trimOrUndefined(argumentRecord?.workdir);
  const encodedWorkdir = command.match(/\bworkdir\s*:\s*["']([^"']+)["']/i)?.[1]
    ?? command.match(/["']workdir["']\s*:\s*["']([^"']+)["']/i)?.[1];
  const workdir = directWorkdir ?? encodedWorkdir;
  return workdir ? `${normalizeComparablePath(workdir)}/SKILL.md` : undefined;
}

function skillNameFromPath(skillMdPath: string): string | undefined {
  const normalized = normalizeComparablePath(skillMdPath);
  const parent = path.posix.basename(path.posix.dirname(normalized)).trim();
  if (!parent || parent === "." || parent.includes("$")) return undefined;
  return parent;
}

function instructionKindFromPath(skillMdPath: string): CodexInstructionReadKind {
  const normalized = `/${normalizeComparablePath(skillMdPath).toLowerCase().replace(/^\/+/, "")}`;
  return normalized.includes("/plugins/") || normalized.includes("/.codex-plugin/")
    ? "capability"
    : "skill";
}

function stableReadId(kind: CodexInstructionReadKind, name: string): string {
  const normalized = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `instruction-read-${kind}-${normalized || "unknown"}`;
}

export class CodexInstructionReadObserver {
  private readonly selectedSkillNames: Set<string>;
  private readonly selectedSkillPaths: Set<string>;
  private readonly readsByKey = new Map<string, CodexInstructionRead>();
  private readonly now: () => Date;

  constructor(options: CodexInstructionReadObserverOptions = {}) {
    this.selectedSkillNames = new Set(
      (options.selectedSkills ?? [])
        .map((skill) => trimOrUndefined(skill.name)?.toLowerCase())
        .filter((name): name is string => Boolean(name))
    );
    this.selectedSkillPaths = new Set(
      (options.selectedSkills ?? [])
        .map((skill) => trimOrUndefined(skill.path))
        .filter((skillPath): skillPath is string => Boolean(skillPath))
        .map(normalizeComparablePath)
    );
    this.now = options.now ?? (() => new Date());
  }

  push(event: RuntimeStreamEvent): CodexInstructionRead[] {
    const raw = asRecord(event.raw);
    const item = asRecord(raw?.item);
    const eventType = trimOrUndefined(event.type) ?? trimOrUndefined(raw?.type);
    if (eventType === "turn.started") {
      return this.recordSelectedSkills();
    }
    if (eventType !== "item.completed") return [];

    const itemType = trimOrUndefined(item?.type);
    let command: string | undefined;
    let paths: string[] = [];
    if (itemType === "command_execution") {
      if (typeof item?.exit_code === "number" && item.exit_code !== 0) return [];
      if (!trimOrUndefined(item?.aggregated_output)) return [];
      command = trimOrUndefined(item?.command);
      if (!command) return [];
      paths = collectSkillMdPaths(command);
    } else if (itemType === "mcp_tool_call") {
      if (item?.success === false || trimOrUndefined(item?.status) === "failed" || item?.error) return [];
      if (!hasNonEmptyOutput(item?.contentItems ?? item?.result)) return [];
      command = serializedText(item?.arguments);
      if (!command) return [];
      paths = collectSkillMdPaths(command);
      const relativePath = collectRelativeSkillMdPath(command, item?.arguments);
      if (relativePath) paths.push(relativePath);
    } else {
      return [];
    }

    const created: CodexInstructionRead[] = [];
    for (const skillMdPath of new Set(paths)) {
      const name = skillNameFromPath(skillMdPath);
      if (!name) continue;
      const kind = instructionKindFromPath(skillMdPath);
      const key = `${kind}:${name.toLowerCase()}`;
      if (this.readsByKey.has(key)) continue;
      const normalizedPath = normalizeComparablePath(skillMdPath);
      const trigger = this.selectedSkillNames.has(name.toLowerCase()) || this.selectedSkillPaths.has(normalizedPath)
        ? "selected"
        : "automatic";
      const read: CodexInstructionRead = {
        id: stableReadId(kind, name),
        name,
        kind,
        trigger,
        readAt: this.now().toISOString()
      };
      this.readsByKey.set(key, read);
      created.push(read);
    }
    return created;
  }

  private recordSelectedSkills(): CodexInstructionRead[] {
    const created: CodexInstructionRead[] = [];
    for (const skillPath of this.selectedSkillPaths) {
      const name = skillNameFromPath(skillPath);
      if (!name) continue;
      const kind = instructionKindFromPath(skillPath);
      const key = `${kind}:${name.toLowerCase()}`;
      if (this.readsByKey.has(key)) continue;
      const read: CodexInstructionRead = {
        id: stableReadId(kind, name),
        name,
        kind,
        trigger: "selected",
        readAt: this.now().toISOString()
      };
      this.readsByKey.set(key, read);
      created.push(read);
    }
    return created;
  }

  reads(): CodexInstructionRead[] {
    return [...this.readsByKey.values()];
  }

  contentPart(): Record<string, unknown> | undefined {
    const reads = this.reads();
    if (reads.length === 0) return undefined;
    return {
      type: "data",
      name: "codex_instruction_reads",
      data: { reads }
    };
  }
}
