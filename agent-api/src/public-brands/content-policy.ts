import type { RuntimeStreamEvent } from "../live-runtime-session.js";
import type { PublicBrandRecord } from "./types.js";

function escapedPattern(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
}

export function applyBrandTextPolicy(value: string, brand: Pick<
  PublicBrandRecord,
  "knowledgeReplacementRules" | "outputProtectionEnabled" | "outputForbiddenTerms"
>): string {
  let next = value;
  for (const rule of brand.knowledgeReplacementRules) {
    next = next.replace(escapedPattern(rule.source), rule.mode === "remove" ? "" : rule.target);
  }
  if (brand.outputProtectionEnabled) {
    for (const term of brand.outputForbiddenTerms) {
      next = next.replace(escapedPattern(term), "[redacted]");
    }
  }
  return next;
}

export function applyBrandPolicyToUnknown(value: unknown, brand: PublicBrandRecord): unknown {
  if (typeof value === "string") return applyBrandTextPolicy(value, brand);
  if (Array.isArray(value)) return value.map((item) => applyBrandPolicyToUnknown(item, brand));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, applyBrandPolicyToUnknown(item, brand)])
  );
}

export function sanitizeRuntimeEventForBrand(event: RuntimeStreamEvent, brand: PublicBrandRecord): RuntimeStreamEvent {
  if (!brand.outputProtectionEnabled) return event;
  return applyBrandPolicyToUnknown(event, brand) as RuntimeStreamEvent;
}

export function brandRuntimePolicyPrompt(brand: PublicBrandRecord): string {
  if (!brand.outputProtectionEnabled) return "";
  const replacements = brand.knowledgeReplacementRules
    .map((rule) => `- ${rule.source} -> ${rule.mode === "remove" ? "omit" : rule.target}`)
    .join("\n");
  return [
    `You are serving the ${brand.platformName} customer brand.`,
    "Never disclose internal platform identity, source-library identity, file paths, or original brand names.",
    replacements ? `Required terminology:\n${replacements}` : "",
    `Forbidden output terms: ${brand.outputForbiddenTerms.join(", ")}.`,
    "Rewrite the answer before returning it if any forbidden term would appear."
  ].filter(Boolean).join("\n");
}
