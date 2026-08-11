export type StreamTextPart = {
  type: "text";
  text: string;
};

export type FinalAnswerReconciliation = {
  changed: boolean;
  corrected: boolean;
  part: StreamTextPart | null;
};

function isStreamTextPart(value: unknown): value is StreamTextPart {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { type?: unknown; text?: unknown };
  return candidate.type === "text" && typeof candidate.text === "string";
}

/**
 * Treat the `done.answer` payload as the authoritative final response.
 * Streaming deltas are only a progressive preview and may be incomplete when
 * the browser misses or reorders an event. The final snapshot must contain one
 * text part with the exact server answer while preserving process/file parts.
 */
export function reconcileAuthoritativeFinalAnswer(
  orderedParts: unknown[],
  authoritativeText: string,
  preferredPart?: StreamTextPart | null
): FinalAnswerReconciliation {
  if (!authoritativeText.trim()) {
    return { changed: false, corrected: false, part: preferredPart ?? null };
  }

  const textParts = orderedParts.filter(isStreamTextPart);
  const preferredIsPresent = Boolean(preferredPart && textParts.includes(preferredPart));
  const target = preferredIsPresent
    ? preferredPart!
    : textParts.at(-1) ?? { type: "text" as const, text: "" };
  const previousCombinedText = textParts.map((part) => part.text).join("");
  const corrected = previousCombinedText.length > 0 && previousCombinedText !== authoritativeText;
  let changed = target.text !== authoritativeText || textParts.length !== 1;

  target.text = authoritativeText;
  if (textParts.length === 0) {
    orderedParts.push(target);
    changed = true;
  } else if (textParts.length > 1) {
    for (let index = orderedParts.length - 1; index >= 0; index -= 1) {
      const part = orderedParts[index];
      if (part !== target && isStreamTextPart(part)) {
        orderedParts.splice(index, 1);
      }
    }
  }

  return { changed, corrected, part: target };
}
