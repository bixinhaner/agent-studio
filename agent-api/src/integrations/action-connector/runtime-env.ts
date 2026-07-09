function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function trimString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

export function actionConnectorRuntimeEnvFromRunConfig(
  codexRunConfig: Record<string, unknown> | undefined
): Record<string, string> {
  const actionConnector = asRecord(codexRunConfig?.actionConnector);
  const runtimeConfigPath = trimString(actionConnector?.runtimeConfigPath);
  return runtimeConfigPath
    ? { ACTION_CONNECTOR_RUNTIME_CONFIG: runtimeConfigPath }
    : {};
}
