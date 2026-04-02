import type { ReasoningEffort } from "../../model-config.js";
import type { IntegrationValidationOutcome } from "./dingtalk-adapter.js";

type OpenAICompatibleApiValidationPayload = {
  apiKey?: string;
  agentModeId?: string;
  knowledgeSetIds: string[];
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: string[] = [];
  for (const item of value) {
    const normalized = asString(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    items.push(normalized);
  }
  return items;
}

function normalizePayload(input: Record<string, unknown>): OpenAICompatibleApiValidationPayload {
  const agentModeId = asString(input.agentModeId) || asString(input.defaultAgentModeId);
  const knowledgeSetIds =
    asStringArray(input.knowledgeSetIds).length > 0
      ? asStringArray(input.knowledgeSetIds)
      : asStringArray(input.defaultKnowledgeSetIds);

  return {
    apiKey: asString(input.apiKey),
    agentModeId,
    knowledgeSetIds
  };
}

export class OpenAICompatibleApiIntegrationAdapter {
  async validate(input: Record<string, unknown>): Promise<IntegrationValidationOutcome> {
    const payload = normalizePayload(asRecord(input) ?? {});
    const missing: string[] = [];

    if (!payload.apiKey) {
      missing.push("apiKey");
    }
    if (!payload.agentModeId) {
      missing.push("agentModeId");
    }

    if (missing.length > 0) {
      return {
        status: "failed",
        summary: "OpenAI-compatible API configuration is incomplete",
        detail: {
          missing
        }
      };
    }

    return {
      status: "success",
      summary: "OpenAI-compatible API configuration looks valid",
      detail: {
        agentModeId: payload.agentModeId,
        knowledgeSetCount: payload.knowledgeSetIds.length
      }
    };
  }
}
