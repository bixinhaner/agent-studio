export function buildTrainingTranslationPrompt(texts: string[]): string {
  return [
    "Translate the following Chinese Bailey employee-training UI content into natural, concise business English.",
    "Return only valid JSON with this exact shape: {\"translations\":[\"...\"]}.",
    "Keep the same number and order of strings.",
    "Preserve Markdown, tables, line breaks, URLs, email addresses, product/model names, commands, log text, IDs, numbers, units, and file names.",
    "Do not add explanations and do not omit information.",
    JSON.stringify({ texts })
  ].join("\n");
}

export function parseTrainingTranslations(value: string, expectedCount: number): string[] {
  const trimmed = value.trim();
  const candidate = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;
  const parsed = JSON.parse(candidate) as { translations?: unknown };
  if (!Array.isArray(parsed.translations)) {
    throw new Error("培训案例英文翻译未返回 translations 数组");
  }
  const translations = parsed.translations.map((item) => typeof item === "string" ? item : "");
  if (translations.length !== expectedCount || translations.some((item) => !item.trim())) {
    throw new Error("培训案例英文翻译返回数量不匹配");
  }
  return translations;
}
