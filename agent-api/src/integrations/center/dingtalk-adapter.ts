import { createDingTalkClient, type DingTalkConfig } from "../../auth/dingtalk.js";

export type IntegrationValidationOutcome = {
  status: "success" | "failed";
  summary: unknown;
  detail: unknown;
};

type DingTalkValidationPayload = {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  scope?: string;
  apiBaseUrl?: string;
  alertAgentId?: string;
  alertUserIds?: string[];
};

type DingTalkValidationClient = {
  validateCredentials?(): Promise<void>;
  listDepartments(input: { parentId?: string | null }): Promise<unknown[]>;
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

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .map((item) => asString(item))
    .filter((item): item is string => Boolean(item));
  return normalized.length ? normalized : undefined;
}

function detailFromError(error: unknown): string {
  return error instanceof Error ? error.message : "DingTalk credential validation failed";
}

function normalizePayload(input: Record<string, unknown>): DingTalkValidationPayload {
  const alertUserIds = asStringArray(input.alertUserIds);
  return {
    clientId: asString(input.clientId),
    clientSecret: asString(input.clientSecret),
    redirectUri: asString(input.redirectUri),
    scope: asString(input.scope),
    apiBaseUrl: asString(input.apiBaseUrl),
    alertAgentId: asString(input.alertAgentId),
    alertUserIds
  };
}

export class DingTalkIntegrationAdapter {
  constructor(
    private readonly clientFactory: (config: DingTalkConfig) => DingTalkValidationClient = (config) =>
      createDingTalkClient(config)
  ) {}

  async validate(input: Record<string, unknown>): Promise<IntegrationValidationOutcome> {
    const payload = normalizePayload(asRecord(input) ?? {});

    try {
      const client = this.clientFactory(payload);
      if (typeof client.validateCredentials === "function") {
        await client.validateCredentials();
      } else {
        await client.listDepartments({ parentId: "0" });
      }
      return {
        status: "success",
        summary: "DingTalk credential validation succeeded",
        detail: {
          validated: "credentials"
        }
      };
    } catch (error) {
      return {
        status: "failed",
        summary: "DingTalk credential validation failed",
        detail: {
          message: detailFromError(error)
        }
      };
    }
  }
}
