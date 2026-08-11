export function modeIdFromPortalRunConfig(config?: Record<string, unknown>): string | undefined {
  const value = config?.mode;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

/**
 * Existing tasks keep their persisted agent unless the client marks a mode
 * change as an explicit user action. This prevents loading placeholders or a
 * stale browser tab from silently changing the agent on the next message.
 */
export function guardPortalThreadModeChange(input: {
  persistedConfig?: Record<string, unknown>;
  incomingConfig?: Record<string, unknown>;
  allowModeChange?: boolean;
}): Record<string, unknown> | undefined {
  const { persistedConfig, incomingConfig, allowModeChange } = input;
  if (!incomingConfig || allowModeChange) return incomingConfig;
  const persistedMode = modeIdFromPortalRunConfig(persistedConfig);
  if (!persistedMode) return incomingConfig;
  if (modeIdFromPortalRunConfig(incomingConfig) === persistedMode) return incomingConfig;
  return {
    ...incomingConfig,
    mode: persistedMode
  };
}
