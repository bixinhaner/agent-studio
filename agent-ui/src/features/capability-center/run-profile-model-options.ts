import { DEFAULT_MODEL, MODEL_OPTIONS } from "../../lib/model-config";

type SelectOption = {
  label: string;
  value: string;
};

const MODEL_LABEL_MAP = new Map(MODEL_OPTIONS.map((option) => [option.value, option.label] as const));

export const DEFAULT_RUN_PROFILE_MODEL = DEFAULT_MODEL;

export function buildRunProfileModelOptions(extraModels: string[] = []): SelectOption[] {
  const seen = new Set<string>();
  const options: SelectOption[] = [];

  function append(model: string) {
    const normalized = model.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    options.push({
      value: normalized,
      label: MODEL_LABEL_MAP.get(normalized) ?? normalized
    });
  }

  MODEL_OPTIONS.forEach((option) => append(option.value));
  extraModels.forEach((model) => append(model));

  return options;
}

export function normalizeRunProfileAllowedModels(models: string[], fallbackModel: string): string[] {
  const normalized = models.map((item) => item.trim()).filter(Boolean);
  const deduped = Array.from(new Set(normalized));
  if (deduped.length > 0) {
    return deduped;
  }
  const fallback = fallbackModel.trim();
  return fallback ? [fallback] : [];
}
