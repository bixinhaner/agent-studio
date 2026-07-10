export const DEFAULT_MODEL = "gpt-5.4";

export const REASONING_EFFORT_VALUES = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra"
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORT_VALUES)[number];

export type CodexModelServiceTier = {
  id: string;
  label: string;
  description?: string;
};

export type CodexModelCapability = {
  id: string;
  label: string;
  description?: string;
  hidden: boolean;
  isDefault: boolean;
  defaultReasoningEffort: ReasoningEffort;
  supportedReasoningEfforts: ReasoningEffort[];
  inputModalities: string[];
  serviceTiers: CodexModelServiceTier[];
  contextLimit?: number;
};

export type CodexModelCatalog = {
  models: CodexModelCapability[];
  source: "app_server" | "fallback";
  fetchedAt: string;
  warning?: string;
};

type ModelConfig = {
  reasoningEfforts: readonly ReasoningEffort[];
  defaultReasoningEffort: ReasoningEffort;
  label: string;
  contextLimit?: number;
};

const DEFAULT_REASONING_EFFORT: ReasoningEffort = "high";
const FRONTIER_REASONING_EFFORTS: readonly ReasoningEffort[] = ["none", "low", "medium", "high", "xhigh"];
const LEGACY_REASONING_EFFORTS: readonly ReasoningEffort[] = ["minimal", "low", "medium", "high", "xhigh"];
const GPT_56_SOL_TERRA_EFFORTS: readonly ReasoningEffort[] = ["low", "medium", "high", "xhigh", "max", "ultra"];
const GPT_56_LUNA_EFFORTS: readonly ReasoningEffort[] = ["low", "medium", "high", "xhigh", "max"];
const DEFAULT_MODEL_CONFIG: ModelConfig = {
  reasoningEfforts: LEGACY_REASONING_EFFORTS,
  defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
  label: "Legacy Model"
};

const MODEL_CONFIGS: Record<string, ModelConfig> = {
  "gpt-5.6-sol": {
    reasoningEfforts: GPT_56_SOL_TERRA_EFFORTS,
    defaultReasoningEffort: "low",
    label: "GPT-5.6 Sol",
    contextLimit: 1_050_000
  },
  "gpt-5.6-terra": {
    reasoningEfforts: GPT_56_SOL_TERRA_EFFORTS,
    defaultReasoningEffort: "medium",
    label: "GPT-5.6 Terra",
    contextLimit: 1_050_000
  },
  "gpt-5.6-luna": {
    reasoningEfforts: GPT_56_LUNA_EFFORTS,
    defaultReasoningEffort: "medium",
    label: "GPT-5.6 Luna",
    contextLimit: 1_050_000
  },
  "gpt-5.5": {
    reasoningEfforts: FRONTIER_REASONING_EFFORTS,
    defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
    label: "GPT-5.5",
    contextLimit: 1_050_000
  },
  "gpt-5.4": {
    reasoningEfforts: FRONTIER_REASONING_EFFORTS,
    defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
    label: "GPT-5.4",
    contextLimit: 1_050_000
  },
  "gpt-5.4-mini": {
    reasoningEfforts: FRONTIER_REASONING_EFFORTS,
    defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
    label: "GPT-5.4 Mini",
    contextLimit: 400_000
  },
  "gpt-5.4-pro": {
    reasoningEfforts: ["medium", "high", "xhigh"],
    defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
    label: "GPT-5.4 Pro"
  },
  "gpt-5.3-codex": {
    reasoningEfforts: LEGACY_REASONING_EFFORTS,
    defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
    label: "GPT-5.3 Codex"
  },
  "gpt-5.2-codex": {
    reasoningEfforts: LEGACY_REASONING_EFFORTS,
    defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
    label: "GPT-5.2 Codex"
  },
  "gpt-5.1-codex-max": {
    reasoningEfforts: LEGACY_REASONING_EFFORTS,
    defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
    label: "GPT-5.1 Codex Max"
  },
  "gpt-5.1-codex": {
    reasoningEfforts: LEGACY_REASONING_EFFORTS,
    defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
    label: "GPT-5.1 Codex"
  },
  "gpt-5-codex": {
    reasoningEfforts: LEGACY_REASONING_EFFORTS,
    defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
    label: "GPT-5 Codex"
  },
  "gpt-5.1-codex-mini": {
    reasoningEfforts: LEGACY_REASONING_EFFORTS,
    defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
    label: "GPT-5.1 Codex Mini"
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
  if (!MODEL_CONFIGS[normalizeModel(model)] && normalized && REASONING_EFFORT_VALUES.includes(normalized)) {
    return normalized;
  }
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

export function fallbackModelCatalog(now = new Date()): CodexModelCatalog {
  const models = Object.entries(MODEL_CONFIGS).map(([id, config]) => ({
    id,
    label: config.label,
    hidden: false,
    isDefault: id === DEFAULT_MODEL,
    defaultReasoningEffort: config.defaultReasoningEffort,
    supportedReasoningEfforts: [...config.reasoningEfforts],
    inputModalities: ["text", "image"],
    serviceTiers: [],
    contextLimit: config.contextLimit
  }));
  return {
    models,
    source: "fallback",
    fetchedAt: now.toISOString()
  };
}

export function validateModelCapabilitySelection(input: {
  catalog: CodexModelCatalog;
  defaultModel: string;
  allowedModels: string[];
  defaultReasoningEffort: string;
}): string | undefined {
  const defaultModel = normalizeModel(input.defaultModel);
  if (!input.allowedModels.map(normalizeModel).includes(defaultModel)) {
    return "默认模型必须包含在允许模型中";
  }
  const capability = input.catalog.models.find((model) => model.id === defaultModel);
  if (!capability) return undefined;
  if (
    capability.supportedReasoningEfforts.length > 0 &&
    !capability.supportedReasoningEfforts.includes(input.defaultReasoningEffort as ReasoningEffort)
  ) {
    return `模型 ${capability.label} 不支持推理强度 ${input.defaultReasoningEffort}`;
  }
  return undefined;
}
