export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type ModelOption = {
  value: string;
  label: string;
  reasoningEfforts: readonly ReasoningEffort[];
  defaultReasoningEffort: ReasoningEffort;
  contextLimit: number;
};

export const DEFAULT_MODEL = "gpt-5.4";
export const DEFAULT_CONTEXT_LIMIT_TOKENS = 262_144;

const DEFAULT_REASONING_EFFORT: ReasoningEffort = "high";
const FRONTIER_REASONING_EFFORTS: readonly ReasoningEffort[] = ["none", "low", "medium", "high", "xhigh"];
const LEGACY_REASONING_EFFORTS: readonly ReasoningEffort[] = ["minimal", "low", "medium", "high", "xhigh"];
const FALLBACK_MODEL_OPTION: ModelOption = {
  value: "legacy",
  label: "Legacy Model",
  reasoningEfforts: LEGACY_REASONING_EFFORTS,
  defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
  contextLimit: DEFAULT_CONTEXT_LIMIT_TOKENS
};
const DEFAULT_MODEL_OPTION: ModelOption = {
  value: DEFAULT_MODEL,
  label: "GPT-5.4（推荐）",
  reasoningEfforts: FRONTIER_REASONING_EFFORTS,
  defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
  contextLimit: DEFAULT_CONTEXT_LIMIT_TOKENS
};

export const MODEL_OPTIONS: ModelOption[] = [
  DEFAULT_MODEL_OPTION,
  {
    value: "gpt-5.5",
    label: "GPT-5.5",
    reasoningEfforts: FRONTIER_REASONING_EFFORTS,
    defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
    contextLimit: DEFAULT_CONTEXT_LIMIT_TOKENS
  },
  {
    value: "gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    reasoningEfforts: FRONTIER_REASONING_EFFORTS,
    defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
    contextLimit: DEFAULT_CONTEXT_LIMIT_TOKENS
  },
  {
    value: "gpt-5.3-codex",
    label: "GPT-5.3 Codex",
    reasoningEfforts: LEGACY_REASONING_EFFORTS,
    defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
    contextLimit: DEFAULT_CONTEXT_LIMIT_TOKENS
  },
  {
    value: "gpt-5.2-codex",
    label: "GPT-5.2 Codex",
    reasoningEfforts: LEGACY_REASONING_EFFORTS,
    defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
    contextLimit: DEFAULT_CONTEXT_LIMIT_TOKENS
  },
  {
    value: "gpt-5.1-codex-max",
    label: "GPT-5.1 Codex Max",
    reasoningEfforts: LEGACY_REASONING_EFFORTS,
    defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
    contextLimit: DEFAULT_CONTEXT_LIMIT_TOKENS
  },
  {
    value: "gpt-5.1-codex",
    label: "GPT-5.1 Codex",
    reasoningEfforts: LEGACY_REASONING_EFFORTS,
    defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
    contextLimit: DEFAULT_CONTEXT_LIMIT_TOKENS
  },
  {
    value: "gpt-5-codex",
    label: "GPT-5 Codex",
    reasoningEfforts: LEGACY_REASONING_EFFORTS,
    defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
    contextLimit: DEFAULT_CONTEXT_LIMIT_TOKENS
  },
  {
    value: "gpt-5.1-codex-mini",
    label: "GPT-5.1 Codex Mini",
    reasoningEfforts: LEGACY_REASONING_EFFORTS,
    defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
    contextLimit: DEFAULT_CONTEXT_LIMIT_TOKENS
  }
];

const MODEL_OPTION_MAP = new Map(MODEL_OPTIONS.map((option) => [option.value, option]));

const REASONING_LABELS: Record<ReasoningEffort, string> = {
  none: "none（最快）",
  minimal: "minimal（最快）",
  low: "low（偏快）",
  medium: "medium（均衡）",
  high: "high（更深入）",
  xhigh: "xhigh（最深入）"
};

export function normalizeModel(input?: string | null): string {
  const normalized = String(input || "").trim();
  return normalized || DEFAULT_MODEL;
}

function modelOptionFor(model: string): ModelOption {
  return MODEL_OPTION_MAP.get(normalizeModel(model)) || FALLBACK_MODEL_OPTION;
}

export function allowedReasoningEffortsForModel(model: string): readonly ReasoningEffort[] {
  return modelOptionFor(model).reasoningEfforts;
}

export function reasoningOptionsForModel(model: string): Array<{ value: ReasoningEffort; label: string }> {
  return allowedReasoningEffortsForModel(model).map((value) => ({
    value,
    label: REASONING_LABELS[value]
  }));
}

export function normalizeReasoningEffortForModel(
  model: string,
  input?: ReasoningEffort | null
): ReasoningEffort {
  const option = modelOptionFor(model);
  const normalized = String(input || "").trim() as ReasoningEffort | "";
  if (normalized && option.reasoningEfforts.includes(normalized)) {
    return normalized;
  }
  if (normalized === "minimal" && option.reasoningEfforts.includes("none")) {
    return "none";
  }
  if (normalized === "none" && option.reasoningEfforts.includes("minimal")) {
    return "minimal";
  }
  return option.defaultReasoningEffort;
}

export function contextLimitForModel(model: string): number {
  return modelOptionFor(model).contextLimit;
}
