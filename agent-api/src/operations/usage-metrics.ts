export function usageTotalTokens(inputTokens: number, outputTokens: number): number {
  return Math.max(0, inputTokens) + Math.max(0, outputTokens);
}

export function billableUncachedInputTokens(inputTokens: number, cachedInputTokens: number): number {
  return Math.max(0, inputTokens - cachedInputTokens);
}

export function usageCacheShare(inputTokens: number, cachedInputTokens: number): number {
  if (!Number.isFinite(inputTokens) || inputTokens <= 0) return 0;
  const boundedCached = Math.min(Math.max(0, cachedInputTokens), inputTokens);
  return boundedCached / inputTokens;
}
