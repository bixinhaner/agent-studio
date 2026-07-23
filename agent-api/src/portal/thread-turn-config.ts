export function mergeRunConfigPreservingSkillSelection(
  persisted: Record<string, unknown> | undefined,
  incoming: Record<string, unknown> | undefined,
  activationPromptsKey: string
): Record<string, unknown> | undefined {
  if (!incoming) return persisted ? { ...persisted } : undefined;
  const merged = {
    ...(persisted ?? {}),
    ...incoming
  };
  for (const key of ["enabledSkills", activationPromptsKey]) {
    if (persisted && Object.prototype.hasOwnProperty.call(persisted, key)) {
      merged[key] = persisted[key];
    } else {
      delete merged[key];
    }
  }
  return merged;
}
