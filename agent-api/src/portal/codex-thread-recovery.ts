function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "");
}

export function isMissingCodexRolloutError(error: unknown): boolean {
  const detail = errorDetail(error);
  return /no rollout found for thread id/i.test(detail) ||
    /thread\/resume failed[^\n]*(?:rollout[^\n]*(?:missing|not found)|(?:missing|not found)[^\n]*rollout)/i.test(detail);
}

export async function startWithMissingCodexRolloutRecovery<T>(input: {
  resumeCodexThreadId?: string;
  start(resumeCodexThreadId?: string): Promise<T>;
  codexThreadId(value: T): string | undefined;
  persistRecoveredCodexThreadId(codexThreadId: string): Promise<void>;
  rollbackRecovered(value: T): Promise<void>;
  onRecover?(input: { failedCodexThreadId: string; error: unknown }): void;
}): Promise<{ value: T; recovered: boolean; failedCodexThreadId?: string }> {
  const resumeCodexThreadId = input.resumeCodexThreadId?.trim();
  try {
    return {
      value: await input.start(resumeCodexThreadId),
      recovered: false
    };
  } catch (error) {
    if (!resumeCodexThreadId || !isMissingCodexRolloutError(error)) throw error;
    input.onRecover?.({ failedCodexThreadId: resumeCodexThreadId, error });

    const replacement = await input.start(undefined);
    const replacementCodexThreadId = input.codexThreadId(replacement)?.trim();
    if (!replacementCodexThreadId) {
      await input.rollbackRecovered(replacement).catch(() => undefined);
      throw new Error("Replacement Codex thread did not return a thread id", { cause: error });
    }
    try {
      await input.persistRecoveredCodexThreadId(replacementCodexThreadId);
    } catch (persistError) {
      await input.rollbackRecovered(replacement).catch(() => undefined);
      throw persistError;
    }
    return {
      value: replacement,
      recovered: true,
      failedCodexThreadId: resumeCodexThreadId
    };
  }
}
