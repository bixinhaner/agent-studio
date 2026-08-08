import type { TrainingTranslationPurpose } from "./training-translation-service.js";

export function buildTrainingTranslationPrompt(texts: string[], purpose: TrainingTranslationPurpose = "content"): string {
  if (purpose === "filename") {
    return [
      "Translate these Chinese display file names into concise, natural English for an employee-training UI.",
      "Return only valid JSON with this exact shape: {\"translations\":[\"...\"]}.",
      "Keep the same number and order of strings.",
      "Preserve file extensions, version numbers, dates, product/model names, IDs, codes, separators, and technical abbreviations.",
      "Translate only the human-readable Chinese wording. Do not add explanations.",
      JSON.stringify({ texts })
    ].join("\n");
  }
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
  const unfenced = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;
  let candidate = unfenced;
  const start = unfenced.indexOf("{");
  if (start >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < unfenced.length; index += 1) {
      const char = unfenced[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          candidate = unfenced.slice(start, index + 1);
          break;
        }
      }
    }
  }
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
