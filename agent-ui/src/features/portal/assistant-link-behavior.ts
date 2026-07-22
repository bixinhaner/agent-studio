export type AssistantLinkBehavior = "new-tab" | "same-document" | "system" | "blocked";

const SYSTEM_LINK_PROTOCOLS = new Set(["mailto:", "tel:"]);
const NAVIGABLE_LINK_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Links written by an assistant must not replace the conversation surface.
 * Previewable thread files are handled before this classifier is called.
 */
export function classifyAssistantLinkHref(href: string, baseUrl: string): AssistantLinkBehavior {
  const normalized = href.trim();
  if (!normalized) return "blocked";
  if (normalized.startsWith("#")) return "same-document";

  try {
    const parsed = new URL(normalized, baseUrl);
    const protocol = parsed.protocol.toLowerCase();
    if (SYSTEM_LINK_PROTOCOLS.has(protocol)) return "system";
    if (NAVIGABLE_LINK_PROTOCOLS.has(protocol)) return "new-tab";
    return "blocked";
  } catch {
    return "blocked";
  }
}
