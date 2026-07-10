import { DEFAULT_MODEL, MODEL_OPTIONS, type ModelOption } from "../../lib/model-config";

type SelectOption = {
  label: string;
  value: string;
};

export const DEFAULT_RUN_PROFILE_MODEL = DEFAULT_MODEL;

export function buildRunProfileModelOptions(extraModels: string[] = [], catalogModels: readonly ModelOption[] = MODEL_OPTIONS): SelectOption[] {
  const seen = new Set<string>();
  const options: SelectOption[] = [];
  const modelLabelMap = new Map(
    [...MODEL_OPTIONS, ...catalogModels].map((option) => [option.value, option.label] as const)
  );

  function append(model: string) {
    const normalized = model.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    options.push({
      value: normalized,
      label: modelLabelMap.get(normalized) ?? normalized
    });
  }

  catalogModels.forEach((option) => append(option.value));
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
