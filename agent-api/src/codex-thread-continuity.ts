export type CodexThreadContinuityInput = {
  threadCodexThreadId?: string | null;
  activeSessionCodexThreadId?: string | null;
  historicalSessionCodexThreadId?: string | null;
};

function normalize(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function resolveCodexThreadContinuity(input: CodexThreadContinuityInput): string | undefined {
  return (
    normalize(input.threadCodexThreadId) ??
    normalize(input.activeSessionCodexThreadId) ??
    normalize(input.historicalSessionCodexThreadId)
  );
}

export async function resolveCodexThreadContinuityWithHistory(input: {
  threadCodexThreadId?: string | null;
  activeSessionCodexThreadId?: string | null;
  loadHistoricalSessionCodexThreadId: () => Promise<string | undefined>;
}): Promise<string | undefined> {
  const current = resolveCodexThreadContinuity(input);
  if (current) return current;
  return resolveCodexThreadContinuity({
    historicalSessionCodexThreadId: await input.loadHistoricalSessionCodexThreadId()
  });
}

export function assertCodexThreadContinuity(input: {
  expectedCodexThreadId?: string | null;
  observedCodexThreadId?: string | null;
  scope: string;
}): void {
  const expected = normalize(input.expectedCodexThreadId);
  const observed = normalize(input.observedCodexThreadId);
  if (!expected || !observed || expected === observed) return;
  throw new Error(`${input.scope} is already bound to a different Codex thread`);
}
