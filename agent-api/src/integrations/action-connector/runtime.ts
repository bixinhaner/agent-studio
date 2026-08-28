import { z } from "zod";

import { actionConnectorConfigSchema, type ActionConnectorConfig } from "../center/action-connector-adapter.js";
import type { ActionConnectorRuntimeInstance } from "./conversation-recorder.js";
import type { ActionConnectorToolBridgeLike } from "./tool-bridge.js";
import type { IntegrationInstanceRepositoryDb } from "../../persistence/integration-instance-repository.js";

export const actionConnectorChatRequestSchema = z.object({
  message: z.string().trim().min(1),
  conversationId: z.string().trim().min(1).optional(),
  clientRunId: z.string().trim().min(1).optional(),
  mode: z.enum(["preview", "execute"]).default("execute"),
  approvedAction: z.object({
    actionId: z.string().trim().min(1),
    input: z.record(z.string(), z.unknown()).optional(),
    dryRun: z.boolean().optional()
  }).optional(),
  locale: z.string().trim().min(1).default("en-US"),
  timezone: z.string().trim().min(1).default("UTC"),
  attachments: z.array(z.object({
    attachmentId: z.string().trim().min(1),
    filename: z.string().trim().min(1).max(180).optional()
  })).max(10).default([]),
  context: z.record(z.string(), z.unknown()).default({})
});

type ParsedActionConnectorChatRequest = z.infer<typeof actionConnectorChatRequestSchema>;
export type ActionConnectorChatRequest = Omit<ParsedActionConnectorChatRequest, "attachments"> & {
  attachments?: ParsedActionConnectorChatRequest["attachments"];
};

export type AgentThoughtStatus = "streaming" | "completed";
export type AgentProcessKind =
  | "status"
  | "thought"
  | "tool_call"
  | "action_preview"
  | "tool_result"
  | "artifact"
  | "ui_intent"
  | "reasoning"
  | "source"
  | "process"
  | "done"
  | "debug"
  | "error";

export type AgentStreamEvent =
  | { type: "start"; runId: string; conversationId: string }
  | {
      type: "tool_request";
      runId: string;
      toolCallId: string;
      tool: "rest.request" | string;
      title: string;
      input: unknown;
    }
  | {
      type: "thought";
      id?: string;
      text: string;
      append?: boolean;
      status?: AgentThoughtStatus;
      at?: string;
      lastEventAt?: number;
    }
  | { type: "delta"; text: string }
  | { type: "tool_call"; callId: string; toolName: string; title: string; input: unknown }
  | { type: "action_preview"; callId: string; title: string; summary: string; risk: "read" | "low" | "high"; preview: unknown }
  | { type: "tool_result"; callId: string; status: "ok" | "error"; output?: unknown; error?: { code: string; message: string; retryable?: boolean } }
  | { type: "process"; id?: string; kind: AgentProcessKind; title: string; detail?: unknown; at?: string }
  | {
      type: "artifact";
      files: Array<{
        artifactId: string;
        filename: string;
        mimeType?: string | null;
        sizeBytes?: number | null;
        previewStatus?: string | null;
        downloadStatus?: string | null;
        blockedReason?: string | null;
      }>;
    }
  | {
      type: "ui_intent";
      intent: {
        kind: "navigate" | "show_records" | "refresh_record" | "toast";
        route?: string;
        entity?: string;
        ids?: string[];
        query?: Record<string, string>;
        message?: string;
      };
    }
  | { type: "done"; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }; durationMs?: number }
  | { type: "error"; error: { code: string; message: string; retryable?: boolean } };

type IntegrationConfigRow = {
  config: unknown;
};

type IntegrationInstanceRow = {
  id: string;
  type: string;
  status: string;
  name: string;
  slug?: string | null;
  organizationId?: string | null;
};

type FetchLike = typeof fetch;

export type ActionConnectorCodexRunnerInput = {
  connector: ActionConnectorRuntimeInstance;
  config: ActionConnectorConfig;
  bridge?: ActionConnectorToolBridgeLike;
  delegationHeaderValue: string;
  request: ActionConnectorChatRequest;
  signal?: AbortSignal;
  emit(event: AgentStreamEvent): void;
};

export type ActionConnectorCodexRunner = (input: ActionConnectorCodexRunnerInput) => Promise<void>;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

async function loadConnector(
  db: IntegrationInstanceRepositoryDb,
  connectorId: string
): Promise<{ instance: ActionConnectorRuntimeInstance; config: ActionConnectorConfig }> {
  const instance = (await db.integrationInstance.findUnique({ where: { id: connectorId } })) as IntegrationInstanceRow | null;
  if (!instance || instance.type !== "action_connector") {
    throw new Error("action connector not found");
  }
  if (instance.status !== "active") {
    throw new Error("action connector is not active");
  }
  const configRow = (await db.integrationInstanceConfig.findUnique({
    where: { integrationInstanceId: connectorId }
  })) as IntegrationConfigRow | null;
  const parsed = actionConnectorConfigSchema.parse(asRecord(configRow?.config));
  return {
    instance: {
      id: instance.id,
      name: instance.name,
      slug: instance.slug,
      organizationId: instance.organizationId
    },
    config: parsed
  };
}

export class ActionConnectorRuntimeService {
  constructor(
    private readonly db: IntegrationInstanceRepositoryDb,
    fetchImpl: FetchLike = fetch,
    private readonly codexRunner?: ActionConnectorCodexRunner,
    private readonly bridge?: ActionConnectorToolBridgeLike
  ) {
    void fetchImpl;
  }

  async streamChat(input: {
    connectorId: string;
    delegationHeaderValue: string;
    request: ActionConnectorChatRequest;
    signal?: AbortSignal;
    emit(event: AgentStreamEvent): void;
  }): Promise<void> {
    if (!this.codexRunner) {
      throw new Error("Codex-backed action connector runtime is not configured.");
    }

    const { instance, config } = await loadConnector(this.db, input.connectorId);
    await this.codexRunner({
      connector: instance,
      config,
      bridge: this.bridge,
      delegationHeaderValue: input.delegationHeaderValue,
      request: input.request,
      signal: input.signal,
      emit: input.emit
    });
  }
}
