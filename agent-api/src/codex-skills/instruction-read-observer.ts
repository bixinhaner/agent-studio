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
    if (eventType !== "item.completed" || trimOrUndefined(item?.type) !== "command_execution") return [];
    if (typeof item?.exit_code === "number" && item.exit_code !== 0) return [];
    if (!trimOrUndefined(item?.aggregated_output)) return [];

    const command = trimOrUndefined(item?.command);
    if (!command) return [];

    const created: CodexInstructionRead[] = [];
    for (const skillMdPath of collectSkillMdPaths(command)) {
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

