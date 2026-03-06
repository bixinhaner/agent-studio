export const DEFAULT_MODEL = "gpt-5.4";

export const REASONING_EFFORT_VALUES = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh"
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORT_VALUES)[number];

type ModelConfig = {
  reasoningEfforts: readonly ReasoningEffort[];
  defaultReasoningEffort: ReasoningEffort;
};

const DEFAULT_REASONING_EFFORT: ReasoningEffort = "high";
const LEGACY_REASONING_EFFORTS: readonly ReasoningEffort[] = ["minimal", "low", "medium", "high", "xhigh"];
const DEFAULT_MODEL_CONFIG: ModelConfig = {
  reasoningEfforts: LEGACY_REASONING_EFFORTS,
  defaultReasoningEffort: DEFAULT_REASONING_EFFORT
};

const MODEL_CONFIGS: Record<string, ModelConfig> = {
  "gpt-5.4": {
    reasoningEfforts: ["none", "low", "medium", "high", "xhigh"],
    defaultReasoningEffort: DEFAULT_REASONING_EFFORT
  },
  "gpt-5.4-pro": {
    reasoningEfforts: ["medium", "high", "xhigh"],
    defaultReasoningEffort: DEFAULT_REASONING_EFFORT
  }
};

export function normalizeModel(input?: string | null): string {
  const normalized = String(input || "").trim();
  return normalized || DEFAULT_MODEL;
}

function configForModel(model: string): ModelConfig {
  return MODEL_CONFIGS[normalizeModel(model)] || DEFAULT_MODEL_CONFIG;
}

export function normalizeReasoningEffortForModel(
  model: string,
  input?: ReasoningEffort | null
): ReasoningEffort {
  const config = configForModel(model);
  const normalized = String(input || "").trim() as ReasoningEffort | "";
  if (normalized && config.reasoningEfforts.includes(normalized)) {
    return normalized;
  }
  if (normalized === "minimal" && config.reasoningEfforts.includes("none")) {
    return "none";
  }
  if (normalized === "none" && config.reasoningEfforts.includes("minimal")) {
    return "minimal";
  }
  return config.defaultReasoningEffort;
}
