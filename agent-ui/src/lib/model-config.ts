export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

export type ModelOption = {
  value: string;
  label: string;
  reasoningEfforts: readonly ReasoningEffort[];
  defaultReasoningEffort: ReasoningEffort;
  contextLimit: number;
};

export type RuntimeModelCapability = {
  id: string;
  label: string;
  description?: string;
  hidden: boolean;
  isDefault: boolean;
  defaultReasoningEffort: ReasoningEffort;
  supportedReasoningEfforts: ReasoningEffort[];
  inputModalities: string[];
  serviceTiers: Array<{ id: string; label: string; description?: string }>;
  contextLimit?: number;
};

export type RuntimeModelCatalog = {
  models: RuntimeModelCapability[];
  source: "app_server" | "fallback";
  fetchedAt: string;
  warning?: string;
};

export const DEFAULT_MODEL = "gpt-5.4";
export const DEFAULT_CONTEXT_LIMIT_TOKENS = 262_144;

const DEFAULT_REASONING_EFFORT: ReasoningEffort = "high";
const FRONTIER_REASONING_EFFORTS: readonly ReasoningEffort[] = ["none", "low", "medium", "high", "xhigh"];
const LEGACY_REASONING_EFFORTS: readonly ReasoningEffort[] = ["minimal", "low", "medium", "high", "xhigh"];
const GPT_56_SOL_TERRA_EFFORTS: readonly ReasoningEffort[] = ["low", "medium", "high", "xhigh", "max", "ultra"];
const GPT_56_LUNA_EFFORTS: readonly ReasoningEffort[] = ["low", "medium", "high", "xhigh", "max"];
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
  contextLimit: 1_050_000
};

export const MODEL_OPTIONS: ModelOption[] = [
  DEFAULT_MODEL_OPTION,
  {
    value: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    reasoningEfforts: GPT_56_SOL_TERRA_EFFORTS,
    defaultReasoningEffort: "low",
    contextLimit: 1_050_000
  },
  {
    value: "gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    reasoningEfforts: GPT_56_SOL_TERRA_EFFORTS,
    defaultReasoningEffort: "medium",
    contextLimit: 1_050_000
  },
  {
    value: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    reasoningEfforts: GPT_56_LUNA_EFFORTS,
    defaultReasoningEffort: "medium",
    contextLimit: 1_050_000
  },
  {
    value: "gpt-5.5",
    label: "GPT-5.5",
    reasoningEfforts: FRONTIER_REASONING_EFFORTS,
    defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
    contextLimit: 1_050_000
  },
  {
    value: "gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    reasoningEfforts: FRONTIER_REASONING_EFFORTS,
    defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
    contextLimit: 400_000
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
  xhigh: "xhigh（最深入）",
  max: "max（质量优先）",
  ultra: "ultra（最深推理）"
};

export function modelOptionsFromCatalog(catalog?: RuntimeModelCatalog | null): ModelOption[] {
  if (!catalog?.models.length) return MODEL_OPTIONS;
  const fallbackByModel = new Map(MODEL_OPTIONS.map((option) => [option.value, option]));
  return catalog.models
    .filter((model) => !model.hidden)
    .map((model) => {
      const fallback = fallbackByModel.get(model.id);
      return {
        value: model.id,
        label: model.label || fallback?.label || model.id,
        reasoningEfforts: model.supportedReasoningEfforts.length
          ? model.supportedReasoningEfforts
          : fallback?.reasoningEfforts ?? LEGACY_REASONING_EFFORTS,
        defaultReasoningEffort: model.defaultReasoningEffort ?? fallback?.defaultReasoningEffort ?? DEFAULT_REASONING_EFFORT,
        contextLimit: model.contextLimit ?? fallback?.contextLimit ?? DEFAULT_CONTEXT_LIMIT_TOKENS
      };
    });
}

export function normalizeModel(input?: string | null): string {
  const normalized = String(input || "").trim();
  return normalized || DEFAULT_MODEL;
}

function modelOptionFor(model: string, modelOptions: readonly ModelOption[] = MODEL_OPTIONS): ModelOption {
  const normalized = normalizeModel(model);
  return modelOptions.find((option) => option.value === normalized) ?? MODEL_OPTION_MAP.get(normalized) ?? FALLBACK_MODEL_OPTION;
}

export function allowedReasoningEffortsForModel(model: string, modelOptions?: readonly ModelOption[]): readonly ReasoningEffort[] {
  return modelOptionFor(model, modelOptions).reasoningEfforts;
}

export function reasoningOptionsForModel(model: string, modelOptions?: readonly ModelOption[]): Array<{ value: ReasoningEffort; label: string }> {
  return allowedReasoningEffortsForModel(model, modelOptions).map((value) => ({
    value,
    label: REASONING_LABELS[value]
  }));
}

export function normalizeReasoningEffortForModel(
  model: string,
  input?: ReasoningEffort | null,
  modelOptions?: readonly ModelOption[]
): ReasoningEffort {
  const option = modelOptionFor(model, modelOptions);
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

export function contextLimitForModel(model: string, modelOptions?: readonly ModelOption[]): number {
  return modelOptionFor(model, modelOptions).contextLimit;
}
