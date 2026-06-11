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

export function applyCodexMemoryToProviderSnapshot(
  snapshot: ManagedCodexProviderSnapshot,
  settings: SystemSettingsCodexMemory | undefined
): ManagedCodexProviderSnapshot {
  return {
    ...snapshot,
    runtimeOptions: applyCodexMemoryToRuntimeOptions(snapshot.runtimeOptions, settings)
  };
}
