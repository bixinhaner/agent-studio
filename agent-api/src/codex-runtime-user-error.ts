export const CODEX_RUNTIME_ERROR_CODE = {
  AI_SERVICE_BUSY: "AI_SERVICE_BUSY",
  SKILL_LOAD_FAILED: "SKILL_LOAD_FAILED"
} as const;

export type CodexRuntimeErrorCode =
  (typeof CODEX_RUNTIME_ERROR_CODE)[keyof typeof CODEX_RUNTIME_ERROR_CODE];

export class CodexRuntimeUserError extends Error {
  readonly retryable = true;

  constructor(
    readonly code: CodexRuntimeErrorCode,
    cause?: unknown
  ) {
    super(code);
    this.name = "CodexRuntimeUserError";
    this.cause = cause;
  }
}

export function isCodexRuntimeUserError(error: unknown): error is CodexRuntimeUserError {
  return error instanceof CodexRuntimeUserError;
}

export type CodexRuntimeErrorPresentation = {
  code: CodexRuntimeErrorCode;
  message: string;
  retryable: boolean;
};

function prefersChinese(locale: string | null | undefined): boolean {
  const primaryLocale = (locale ?? "")
    .split(",", 1)[0]
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  return primaryLocale === "zh" || primaryLocale?.startsWith("zh-") === true;
}

export function presentCodexRuntimeError(
  error: unknown,
  locale?: string | null
): CodexRuntimeErrorPresentation | undefined {
  if (!isCodexRuntimeUserError(error)) return undefined;

  switch (error.code) {
    case CODEX_RUNTIME_ERROR_CODE.AI_SERVICE_BUSY:
      return {
        code: error.code,
        message: prefersChinese(locale)
          ? "AI 服务当前繁忙，请稍后再试。"
          : "The AI service is currently busy. Please try again later.",
        retryable: error.retryable
      };
    case CODEX_RUNTIME_ERROR_CODE.SKILL_LOAD_FAILED:
      return {
        code: error.code,
        message: prefersChinese(locale)
          ? "所选 Skill 暂时未能加载，本次未开始执行。请重新选择后再试。"
          : "The selected Skill could not be loaded, so this request was not started. Select it again and retry.",
        retryable: error.retryable
      };
  }
}
