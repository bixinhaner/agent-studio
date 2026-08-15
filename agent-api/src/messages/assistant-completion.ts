export type AssistantCompletionLocale = "zh" | "en";

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function resolveAssistantCompletionLocale(value: unknown): AssistantCompletionLocale {
  const locale = trimOrUndefined(value)?.toLowerCase() ?? "";
  return locale.startsWith("zh") ? "zh" : "en";
}

export function resolveCompletedAssistantText(input: {
  answerText?: unknown;
  emptyAnswerText?: unknown;
  generatedArtifactCount?: number;
  locale?: unknown;
}): string {
  const answerText = trimOrUndefined(input.answerText);
  if (answerText) return answerText;

  const locale = resolveAssistantCompletionLocale(input.locale);
  if ((input.generatedArtifactCount ?? 0) > 0) {
    return locale === "zh"
      ? "生成已完成，结果已附在本次回复中。"
      : "Generation completed. The result is attached to this response.";
  }

  return trimOrUndefined(input.emptyAnswerText) ?? (
    locale === "zh"
      ? "处理已完成，但没有生成文本回复。"
      : "Processing completed, but no text response was generated."
  );
}
