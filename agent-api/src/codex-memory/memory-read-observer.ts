import type { RuntimeStreamEvent } from "../live-runtime-session.js";

/**
 * Detects the turns in which Codex actually looked something up in its memory folder.
 *
 * Codex always has `memory_summary.md` in its prompt, so "memory available" says nothing about
 * a single answer. A turn only counts when a successful tool call returned content from
 * `<codexHome>/memories/` (e.g. `rg ... memories/MEMORY.md`, reading a rollout summary or a
 * memory skill). Searches without matches exit non-zero and are ignored.
 */
export const MEMORY_CONTEXT_PART_NAME = "agent_studio_memory_context";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function hasOutput(value: unknown): boolean {
  if (typeof value === "string") return Boolean(value.trim());
  if (Array.isArray(value)) return value.some(hasOutput);
  const record = asRecord(value);
  if (!record) return false;
  return [record.text, record.output, record.content, record.contentItems, record.result].some(hasOutput);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class CodexMemoryReadObserver {
  private readonly pattern: RegExp | undefined;
  private used = false;

  constructor(options: { codexHome?: string }) {
    const home = options.codexHome?.trim().replace(/\/+$/, "");
    // The run's own memory folder, by absolute path or through $CODEX_HOME.
    this.pattern = home
      ? new RegExp(`(?:${escapeRegExp(home)}|\\$\\{?CODEX_HOME\\}?)/memories(?:/|["'\\s\`;|&)]|$)`)
      : undefined;
  }

  /** Returns true for the first event that shows a memory lookup in this turn. */
  push(event: RuntimeStreamEvent): boolean {
    if (this.used || !this.pattern) return false;
    const raw = asRecord(event.raw);
    if ((event.type || raw?.type) !== "item.completed") return false;
    const item = asRecord(raw?.item);
    let input = "";
    if (item?.type === "command_execution") {
      if (typeof item.exit_code === "number" && item.exit_code !== 0) return false;
      if (!hasOutput(item.aggregated_output)) return false;
      input = text(item.command);
    } else if (item?.type === "mcp_tool_call") {
      if (item.success === false || item.status === "failed" || item.error) return false;
      if (!hasOutput(item.contentItems ?? item.result)) return false;
      input = text(item.arguments);
    } else {
      return false;
    }
    if (!this.pattern.test(input.replace(/\\+\//g, "/"))) return false;
    this.used = true;
    return true;
  }

  contentPart(): Record<string, unknown> | undefined {
    return this.used ? { type: "data", name: MEMORY_CONTEXT_PART_NAME, data: { used: true } } : undefined;
  }
}
