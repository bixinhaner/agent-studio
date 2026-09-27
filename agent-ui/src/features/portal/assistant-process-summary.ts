type UnknownRecord = Record<string, unknown>;

export type AssistantProcessStepKind = "reasoning" | "tool" | "source" | "meta" | "process" | "done" | "error" | "debug";

export type AssistantProcessCategory =
  | "search"
  | "command"
  | "tool"
  | "image-generate"
  | "image-inspect"
  | "plan"
  | "files"
  | "agent"
  | "context"
  | "other";

export type AssistantProcessStepStatus = "running" | "done" | "error";

export interface AssistantProcessStep {
  id: string;
  kind: AssistantProcessStepKind;
  category: AssistantProcessCategory;
  status: AssistantProcessStepStatus;
  /** Title as produced by the backend (English); used when no category label applies. */
  title: string;
  /** Short human subject, e.g. the search query or tool name. */
  subject?: string;
  /** Raw technical detail (command, tool args); shown only when the full trace is enabled. */
  detail?: string;
  startedAt?: number;
  endedAt?: number;
}

export interface AssistantProcessSkill {
  id: string;
  name: string;
  kind: "skill" | "capability";
}

export interface AssistantProcessSummary {
  skills: AssistantProcessSkill[];
  /** Model commentary / reasoning, in order, complete. */
  thoughts: string[];
  steps: AssistantProcessStep[];
  counts: Partial<Record<AssistantProcessCategory, number>>;
  sourceCount: number;
  sources: Array<{ url: string; title: string }>;
  /** First to last recorded step timestamp, if timestamps exist. */
  durationMs?: number;
  thinking: boolean;
  hasError: boolean;
  hasProcess: boolean;
}

type CatalogEntry = { category: AssistantProcessCategory; phase: "start" | "end" };

/** Step titles emitted by the portal stream and codex-execution-service, paired start/end. */
const STEP_TITLE_CATALOG: Record<string, CatalogEntry> = {
  "searching the web": { category: "search", phase: "start" },
  "search completed": { category: "search", phase: "end" },
  "running workspace operation": { category: "command", phase: "start" },
  "workspace operation completed": { category: "command", phase: "end" },
  "using tool": { category: "tool", phase: "start" },
  "tool step completed": { category: "tool", phase: "end" },
  "tool call completed": { category: "tool", phase: "end" },
  "generating image": { category: "image-generate", phase: "start" },
  "image generated": { category: "image-generate", phase: "end" },
  "inspecting image": { category: "image-inspect", phase: "start" },
  "image inspected": { category: "image-inspect", phase: "end" },
  "planning the work": { category: "plan", phase: "start" },
  "plan updated": { category: "plan", phase: "end" },
  "preparing file updates": { category: "files", phase: "start" },
  "files updated": { category: "files", phase: "end" },
  "working with another agent": { category: "agent", phase: "start" },
  "agent work updated": { category: "agent", phase: "end" },
  "context window is full. compressing context.": { category: "context", phase: "start" },
  "context compressed": { category: "context", phase: "end" }
};

/** Bookkeeping rows that carry no information for the reader. */
const HIDDEN_STEP_TITLES = new Set([
  "processing step",
  "response completed",
  "analyzing context",
  "preparing your workspace",
  "stopped"
]);

/** Data parts folded into the process summary instead of rendering on their own. */
export const SUMMARIZED_PROCESS_PART_NAMES = new Set([
  "codex_instruction_reads",
  "codex_commentary",
  "codex_trace_batch",
  "codex_process"
]);

const STEP_KINDS: AssistantProcessStepKind[] = ["reasoning", "tool", "source", "meta", "process", "done", "error", "debug"];

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asKind(value: unknown): AssistantProcessStepKind {
  return STEP_KINDS.includes(value as AssistantProcessStepKind) ? (value as AssistantProcessStepKind) : "process";
}

function asTime(value: unknown): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Legacy generic pairing: "Running X" / "X completed". */
export function processStepKey(title: string): string {
  return normalizeTitle(title)
    .replace(/^(running|starting|started|calling|searching|using|正在|开始)\s*/u, "")
    .replace(/\s*(completed|complete|finished|done|succeeded|已完成|完成)$/u, "")
    .replace(/[.…。]+$/u, "")
    .trim();
}

const GENERIC_START = /^(running|starting|calling|searching|using|generating|preparing|planning|working|inspecting|正在|开始)\b/iu;

function classify(title: string): CatalogEntry | null {
  return STEP_TITLE_CATALOG[normalizeTitle(title)] || null;
}

function subjectFor(category: AssistantProcessCategory, detail: string): string | undefined {
  if (!detail) return undefined;
  if (category === "search") return detail.replace(/\s*\.\.\.$/, "").trim() || undefined;
  if (category === "tool") {
    const tool = detail.match(/(?:^|\n)tool:\s*(.+)/i)?.[1]?.trim();
    return tool || undefined;
  }
  return undefined;
}

type RawStep = { id: string; kind: AssistantProcessStepKind; title: string; detail: string; at?: number };

function pushStep(steps: AssistantProcessStep[], raw: RawStep): void {
  const normalized = normalizeTitle(raw.title);
  if (HIDDEN_STEP_TITLES.has(normalized) && raw.kind !== "error") return;
  const entry = classify(raw.title);
  const category: AssistantProcessCategory = entry?.category || "other";
  const isStart = entry ? entry.phase === "start" : GENERIC_START.test(raw.title.trim());
  const isError = raw.kind === "error";
  const previous = steps[steps.length - 1];

  const pairsWithPrevious =
    previous &&
    previous.status === "running" &&
    !isStart &&
    !isError &&
    (entry
      ? previous.category === category
      : previous.category === "other" && processStepKey(previous.title) === processStepKey(raw.title));

  if (pairsWithPrevious && previous) {
    previous.status = "done";
    previous.title = raw.title;
    previous.detail = raw.detail || previous.detail;
    previous.subject = subjectFor(category, raw.detail) || previous.subject;
    previous.endedAt = raw.at ?? previous.endedAt;
    if (raw.kind !== "done") previous.kind = raw.kind;
    return;
  }

  steps.push({
    id: raw.id,
    kind: raw.kind,
    category,
    status: isError ? "error" : isStart ? "running" : "done",
    title: raw.title,
    subject: subjectFor(category, raw.detail),
    detail: raw.detail || undefined,
    startedAt: raw.at,
    endedAt: isStart ? undefined : raw.at
  });
}

export function summarizeAssistantProcess(content: unknown, options: { running?: boolean } = {}): AssistantProcessSummary {
  const skills: AssistantProcessSkill[] = [];
  const thoughts: string[] = [];
  const steps: AssistantProcessStep[] = [];
  const sourceUrls = new Set<string>();
  const sources: Array<{ url: string; title: string }> = [];
  let thinking = false;
  let hasError = false;
  let seq = 0;

  const parts = Array.isArray(content) ? content : [];
  for (const part of parts) {
    const item = asRecord(part);
    if (!item) continue;
    const type = asText(item.type);
    const name = asText(item.name);

    if (type === "source") {
      const url = asText(item.url);
      if (url && !sourceUrls.has(url)) {
        sourceUrls.add(url);
        sources.push({ url, title: asText(item.title) });
      }
      continue;
    }

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
        pushStep(steps, { id: asText(row.id) || `step-${++seq}`, kind, title, detail: asText(row.detail), at: asTime(row.at) });
      }
      continue;
    }

    if (name === "codex_process") {
      const kind = asKind(data.kind);
      if (kind === "error") hasError = true;
      const title = asText(data.title);
      if (!title) continue;
      pushStep(steps, { id: `process-${++seq}`, kind, title, detail: asText(data.detail), at: asTime(data.at) });
    }
  }

  // Once the run is over nothing is still "running".
  if (!options.running) {
    for (const step of steps) if (step.status === "running") step.status = "done";
  }

  const counts: Partial<Record<AssistantProcessCategory, number>> = {};
  for (const step of steps) counts[step.category] = (counts[step.category] || 0) + 1;

  const times = steps.flatMap((step) => [step.startedAt, step.endedAt]).filter((value): value is number => typeof value === "number");
  const durationMs = times.length >= 2 ? Math.max(...times) - Math.min(...times) : undefined;

  return {
    skills,
    thoughts,
    steps,
    counts,
    sourceCount: sourceUrls.size,
    sources,
    durationMs: durationMs && durationMs > 0 ? durationMs : undefined,
    thinking,
    hasError,
    hasProcess: skills.length > 0 || thoughts.length > 0 || steps.length > 0
  };
}
