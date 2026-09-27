type UnknownRecord = Record<string, unknown>;

export type AssistantProcessStepKind = "reasoning" | "tool" | "source" | "meta" | "process" | "done" | "error" | "debug";

export interface AssistantProcessStep {
  id: string;
  kind: AssistantProcessStepKind;
  title: string;
  detail?: string;
}

export interface AssistantProcessSkill {
  id: string;
  name: string;
  kind: "skill" | "capability";
}

export interface AssistantProcessSummary {
  /** Skills or capabilities whose instructions were read for this answer. */
  skills: AssistantProcessSkill[];
  /** Model commentary / reasoning lines, in order. */
  thoughts: string[];
  /** Process steps with consecutive start/finish pairs merged into one step. */
  steps: AssistantProcessStep[];
  /** True while any commentary part is still streaming. */
  thinking: boolean;
  /** Best short description of what is happening right now. */
  liveText: string;
  hasError: boolean;
  hasProcess: boolean;
}

const STEP_KINDS: AssistantProcessStepKind[] = ["reasoning", "tool", "source", "meta", "process", "done", "error", "debug"];

/** Data parts folded into the one-line process summary instead of rendering on their own. */
export const SUMMARIZED_PROCESS_PART_NAMES = new Set([
  "codex_instruction_reads",
  "codex_commentary",
  "codex_trace_batch",
  "codex_process"
]);

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asKind(value: unknown): AssistantProcessStepKind {
  return STEP_KINDS.includes(value as AssistantProcessStepKind) ? (value as AssistantProcessStepKind) : "process";
}

/**
 * Normalizes a step title so that "Running workspace operation" and
 * "Workspace operation completed" (or 正在…/…完成) collapse to one key.
 */
export function processStepKey(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/^(running|starting|started|calling|正在|开始)\s*/u, "")
    .replace(/\s*(completed|complete|finished|done|succeeded|已完成|完成)$/u, "")
    .replace(/[.…。]+$/u, "")
    .trim();
}

const START_WORDING = /^(running|starting|started|calling|正在|开始)/iu;

type OpenStep = AssistantProcessStep & { open?: boolean };

function pushStep(steps: OpenStep[], step: AssistantProcessStep): void {
  const previous = steps[steps.length - 1];
  const isStart = START_WORDING.test(step.title.trim());
  if (
    previous?.open &&
    !isStart &&
    previous.kind !== "error" &&
    step.kind !== "error" &&
    processStepKey(previous.title) === processStepKey(step.title)
  ) {
    // A "Running X" row followed by its "X completed" row is one step.
    previous.title = step.title;
    previous.kind = step.kind === "done" ? previous.kind : step.kind;
    previous.detail = step.detail || previous.detail;
    previous.open = false;
    return;
  }
  steps.push({ ...step, open: isStart });
}

export function summarizeAssistantProcess(content: unknown): AssistantProcessSummary {
  const skills: AssistantProcessSkill[] = [];
  const thoughts: string[] = [];
  const steps: OpenStep[] = [];
  let thinking = false;
  let hasError = false;
  let seq = 0;

  const parts = Array.isArray(content) ? content : [];
  for (const part of parts) {
    const item = asRecord(part);
    if (!item) continue;
    const type = asText(item.type);
    const name = asText(item.name);

    if (type === "reasoning") {
      const text = asText(item.text);
      if (text) thoughts.push(text);
      continue;
    }

    if (type !== "data" || !SUMMARIZED_PROCESS_PART_NAMES.has(name)) continue;
    const data = asRecord(item.data) || {};

    if (name === "codex_instruction_reads") {
      const reads = Array.isArray(data.reads) ? data.reads : [];
      reads.forEach((read, index) => {
        const entry = asRecord(read);
        const readName = asText(entry?.name);
        const kind = entry?.kind === "capability" ? "capability" : entry?.kind === "skill" ? "skill" : "";
        if (!readName || !kind) return;
        if (skills.some((skill) => skill.name === readName && skill.kind === kind)) return;
        skills.push({ id: asText(entry?.id) || `instruction-read-${index + 1}`, name: readName, kind });
      });
      continue;
    }

    if (name === "codex_commentary") {
      if (data.status === "streaming") thinking = true;
      const entries = Array.isArray(data.entries) ? data.entries : [];
      let added = 0;
      for (const rawEntry of entries) {
        const entry = asRecord(rawEntry);
        if (!entry) continue;
        if (entry.status === "streaming") thinking = true;
        const lines = Array.isArray(entry.lines) ? entry.lines.map(asText).filter(Boolean) : [];
        const text = asText(entry.text);
        if (lines.length > 0) {
          thoughts.push(...lines);
          added += lines.length;
        } else if (text) {
          thoughts.push(text);
          added += 1;
        }
      }
      if (added === 0) {
        const lines = Array.isArray(data.lines) ? data.lines.map(asText).filter(Boolean) : [];
        const text = asText(data.text);
        if (lines.length > 0) thoughts.push(...lines);
        else if (text) thoughts.push(text);
      }
      continue;
    }

    if (name === "codex_trace_batch") {
      const rows = Array.isArray(data.rows) ? data.rows : [];
      for (const rawRow of rows) {
        const row = asRecord(rawRow);
        if (!row) continue;
        const kind = asKind(row.kind);
        if (kind === "error") hasError = true;
        const title = asText(row.title);
        if (!title) continue;
        pushStep(steps, { id: asText(row.id) || `step-${++seq}`, kind, title, detail: asText(row.detail) || undefined });
      }
      continue;
    }

    if (name === "codex_process") {
      const kind = asKind(data.kind);
      if (kind === "error") hasError = true;
      const title = asText(data.title);
      if (!title) continue;
      pushStep(steps, { id: `process-${++seq}`, kind, title, detail: asText(data.detail) || undefined });
    }
  }

  const lastStep = steps[steps.length - 1];
  const lastThought = thoughts[thoughts.length - 1] || "";
  const liveText = thinking && lastThought ? lastThought : lastStep?.title || lastThought;

  return {
    skills,
    thoughts,
    steps: steps.map(({ open: _open, ...step }) => step),
    thinking,
    liveText,
    hasError,
    hasProcess: skills.length > 0 || thoughts.length > 0 || steps.length > 0
  };
}
