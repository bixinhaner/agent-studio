import type { CodexRuntimeOptions } from "./codex-runtime.js";
import type { ManagedCodexProviderSnapshot } from "./managed-codex-provider.js";
import type { SystemSettingsCodexMemory } from "./system-settings/types.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function mergeCodexConfig(
  base: Record<string, unknown> | undefined,
  override: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!base && !override) return undefined;
  if (!base) return override ? structuredClone(override) : undefined;
  if (!override) return structuredClone(base);
  const merged: Record<string, unknown> = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    const current = merged[key];
    merged[key] =
      isPlainObject(current) && isPlainObject(value)
        ? mergeCodexConfig(current, value)
        : structuredClone(value);
  }
  return merged;
}

export function buildCodexMemoryConfigOverrides(
  settings: SystemSettingsCodexMemory | undefined
): Record<string, unknown> | undefined {
  if (!settings) {
    return undefined;
  }
  if (!settings.enabled) {
    return {
      features: {
        memories: false
      },
      memories: {
        use_memories: false,
        generate_memories: false
      }
    };
  }
  return {
    features: {
      memories: true
    },
    memories: {
      use_memories: settings.useMemories,
      // Codex native memory is the only generator; the retired Agent Studio engine no longer turns it off.
      generate_memories: settings.generateMemories,
      disable_on_external_context: settings.disableOnExternalContext,
      min_rate_limit_remaining_percent: settings.minRateLimitRemainingPercent,
      min_rollout_idle_hours: settings.minRolloutIdleHours,
      max_rollout_age_days: settings.maxRolloutAgeDays,
      max_unused_days: settings.maxUnusedDays
    }
  };
}

export function applyCodexMemoryToRuntimeOptions(
  runtimeOptions: CodexRuntimeOptions | undefined,
  settings: SystemSettingsCodexMemory | undefined
): CodexRuntimeOptions {
  const memoryConfig = buildCodexMemoryConfigOverrides(settings);
  if (!runtimeOptions && !memoryConfig) return {};
  return {
    ...(runtimeOptions ?? {}),
    config: mergeCodexConfig(runtimeOptions?.config, memoryConfig)
  };
}

/** Memory generation is on for this provider: ChatGPT sign-in follows the switch, API-key providers also need their own opt-in. */
export function codexMemoryGenerationActive(
  providerKind: ManagedCodexProviderSnapshot["kind"] | undefined,
  settings: SystemSettingsCodexMemory | undefined
): boolean {
  if (!settings?.enabled || !settings.generateMemories) return false;
  return providerKind === "chatgpt" || settings.generateMemoriesWithApiProvider;
}

/**
 * With an API-key provider (DeepSeek and other OpenAI-compatible endpoints) every memory extraction and
 * consolidation call is billed per token, and consolidation runs as a multi-turn agent, so generation is off
 * unless `generateMemoriesWithApiProvider` opts in. Existing memories are still read (use_memories untouched).
 * When it is on, Codex's default memory models are OpenAI names (e.g. gpt-5.6-luna) that such providers
 * reject, so both phases are pinned to the provider's default model. ChatGPT sign-in keeps Codex's own choice.
 */
export function buildCodexMemoryModelOverrides(
  snapshot: Pick<ManagedCodexProviderSnapshot, "kind" | "config">,
  settings: SystemSettingsCodexMemory | undefined
): Record<string, unknown> | undefined {
  if (!settings?.enabled || snapshot.kind === "chatgpt") return undefined;
  if (!codexMemoryGenerationActive(snapshot.kind, settings)) {
    return { memories: { generate_memories: false } };
  }
  const model = snapshot.config.defaultModel?.trim();
  if (!model) return undefined;
  return { memories: { extract_model: model, consolidation_model: model } };
}

export function applyCodexMemoryToProviderSnapshot(
  snapshot: ManagedCodexProviderSnapshot,
  settings: SystemSettingsCodexMemory | undefined
): ManagedCodexProviderSnapshot {
  const runtimeOptions = applyCodexMemoryToRuntimeOptions(snapshot.runtimeOptions, settings);
  return {
    ...snapshot,
    runtimeOptions: {
      ...runtimeOptions,
      config: mergeCodexConfig(runtimeOptions.config, buildCodexMemoryModelOverrides(snapshot, settings))
    }
  };
}
