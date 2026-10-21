import type { CodexModelCapability } from "./model-config.js";

/** Provider integration config key holding admin-set display names, keyed by model ID. */
export const MODEL_DISPLAY_NAMES_CONFIG_KEY = "modelDisplayNames";

const MODELS_REQUEST_TIMEOUT_MS = 5_000;

/** Admin-set display names from a provider integration config; blank entries are ignored. */
export function readModelDisplayNames(config: Record<string, unknown> | undefined): Map<string, string> {
  const names = new Map<string, string>();
  const value = config?.[MODEL_DISPLAY_NAMES_CONFIG_KEY];
  if (!value || typeof value !== "object" || Array.isArray(value)) return names;
  for (const [modelId, name] of Object.entries(value)) {
    const id = modelId.trim();
    const label = typeof name === "string" ? name.trim() : "";
    if (id && label) names.set(id, label);
  }
  return names;
}

/**
 * Codex lists API-key provider models by their API ID (e.g. `deepseek-flash`). Providers that follow
 * the DeepSeek `/models` schema also return a `name` meant for model pickers (e.g. `DeepSeek-V4.1-Flash`).
 * Any failure returns an empty map so the catalog keeps its own labels.
 */
export async function fetchProviderModelNames(
  input: { baseUrl?: string; apiKey?: string },
  fetchImpl: typeof fetch = fetch
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const baseUrl = input.baseUrl?.trim().replace(/\/+$/, "");
  if (!baseUrl || !input.apiKey) return names;
  try {
    const response = await fetchImpl(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${input.apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(MODELS_REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) return names;
    const body = (await response.json()) as { data?: unknown };
    if (!Array.isArray(body.data)) return names;
    for (const item of body.data) {
      if (!item || typeof item !== "object") continue;
      const { id, name } = item as { id?: unknown; name?: unknown };
      if (typeof id === "string" && typeof name === "string" && name.trim()) names.set(id, name.trim());
    }
  } catch {
    // Labels are cosmetic; the model list must not fail because the provider's /models did.
  }
  return names;
}

/** Label precedence: admin override, then the provider's own display name, then Codex's label. */
export function applyModelDisplayNames(
  models: CodexModelCapability[],
  sources: { overrides: Map<string, string>; providerNames: Map<string, string> }
): CodexModelCapability[] {
  return models.map((model) => {
    const label = sources.overrides.get(model.id) ?? sources.providerNames.get(model.id);
    return label ? { ...model, label } : model;
  });
}
