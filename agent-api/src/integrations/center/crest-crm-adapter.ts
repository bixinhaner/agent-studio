import type { IntegrationValidationOutcome } from "./dingtalk-adapter.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeBaseUrl(value: unknown): string | undefined {
  const raw = asString(value);
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    return parsed.href.replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

export class CrestCrmIntegrationAdapter {
  async validate(input: Record<string, unknown>): Promise<IntegrationValidationOutcome> {
    const payload = asRecord(input) ?? {};
    const baseUrl = normalizeBaseUrl(payload.baseUrl);
    const clientId = asString(payload.clientId);
    const clientSecret = asString(payload.clientSecret);
    const mcpRpcPath = asString(payload.mcpRpcPath) || "/v1/agent-studio/mcp/rpc";
    const actionCatalogPath = asString(payload.actionCatalogPath) || "/v1/agent-actions/catalog";
    const missing = [
      ...(baseUrl ? [] : ["baseUrl"]),
      ...(clientId ? [] : ["clientId"]),
      ...(clientSecret ? [] : ["clientSecret"])
    ];

    if (missing.length > 0) {
      return {
        status: "failed",
        summary: "Crest CRM configuration is incomplete",
        detail: { missing }
      };
    }

    try {
      const response = await fetch(`${baseUrl}/v1/agent-studio/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, clientSecret })
      });
      const detail = (await response.json().catch(() => ({}))) as unknown;
      if (!response.ok) {
        return {
          status: "failed",
          summary: "Crest CRM rejected the integration credentials",
          detail: { status: response.status, response: detail }
        };
      }
      return {
        status: "success",
        summary: "Crest CRM connection validated",
        detail: {
          baseUrl,
          mcpRpcPath,
          actionCatalogPath,
          capabilities: asRecord(detail)?.capabilities ?? []
        }
      };
    } catch (error) {
      return {
        status: "failed",
        summary: "Crest CRM is unreachable",
        detail: { error: error instanceof Error ? error.message : "network error" }
      };
    }
  }
}
