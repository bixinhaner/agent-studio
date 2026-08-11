import fs from "node:fs/promises";
import path from "node:path";

import type { CodexTurnSkill } from "../codex-runtime.js";
import {
  CODEX_RUNTIME_ERROR_CODE,
  CodexRuntimeUserError
} from "../codex-runtime-user-error.js";

export type PortalTurnSkillSelection = {
  name: string;
  sourcePath?: string;
};

const SKILL_NAME_RE = /^[A-Za-z0-9._-]{2,64}$/;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function frontmatterSkillName(content: string): string | undefined {
  const frontmatter = content.match(FRONTMATTER_RE)?.[1];
  if (!frontmatter) return undefined;
  const raw = frontmatter.match(/^name\s*:\s*(.+?)\s*$/m)?.[1]?.trim();
  if (!raw) return undefined;
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return trimOrUndefined(raw.slice(1, -1));
  }
  return trimOrUndefined(raw);
}

function skillLoadError(cause: unknown): CodexRuntimeUserError {
  return new CodexRuntimeUserError(CODEX_RUNTIME_ERROR_CODE.SKILL_LOAD_FAILED, cause);
}

async function resolveSkillMdPath(skill: PortalTurnSkillSelection): Promise<string | undefined> {
  const name = trimOrUndefined(skill.name);
  if (!name || !SKILL_NAME_RE.test(name)) {
    throw skillLoadError(new Error("Selected Skill has an invalid name"));
  }
  const sourcePath = trimOrUndefined(skill.sourcePath);
  if (!sourcePath) return undefined;

  try {
    const sourceRoot = await fs.realpath(sourcePath);
    const candidatePath = path.join(sourcePath, "SKILL.md");
    const candidateStat = await fs.lstat(candidatePath);
    if (!candidateStat.isFile() || candidateStat.isSymbolicLink()) {
      throw new Error("Selected Skill entrypoint is not a regular file");
    }
    const skillMdPath = await fs.realpath(candidatePath);
    if (path.dirname(skillMdPath) !== sourceRoot) {
      throw new Error("Selected Skill entrypoint escapes its published directory");
    }
    const content = await fs.readFile(skillMdPath, "utf8");
    if (frontmatterSkillName(content) !== name) {
      throw new Error("Selected Skill metadata does not match the published name");
    }
    return skillMdPath;
  } catch (error) {
    if (error instanceof CodexRuntimeUserError) throw error;
    throw skillLoadError(error);
  }
}

export async function resolvePortalTurnSkillInputs(
  selections: PortalTurnSkillSelection[]
): Promise<CodexTurnSkill[]> {
  const resolved: CodexTurnSkill[] = [];
  const names = new Set<string>();
  for (const selection of selections) {
    const name = trimOrUndefined(selection.name);
    if (!name || names.has(name)) continue;
    names.add(name);
    const skillMdPath = await resolveSkillMdPath(selection);
    if (skillMdPath) resolved.push({ name, path: skillMdPath });
  }
  return resolved;
}

export function withExplicitSkillMentions(
  message: string,
  selections: PortalTurnSkillSelection[]
): string {
  const mentions = [...new Set(
    selections
      .map((selection) => trimOrUndefined(selection.name))
      .filter((name): name is string => Boolean(name && SKILL_NAME_RE.test(name)))
  )]
    .filter((name) => !new RegExp(`(^|\\s)\\$${name.replace(/\./g, "\\.")}(?=\\s|$)`).test(message))
    .map((name) => `$${name}`);
  if (mentions.length === 0) return message;
  return `${mentions.join(" ")}\n\n${message}`;
}
