import { randomUUID } from "node:crypto";

import type { ConversationRecordService } from "../../operations/conversation-record-service.js";
import type { UsageRecorder } from "../../operations/usage-recorder.js";
import type { StoredMessageItem, ThreadRecord } from "../../persistence/thread-repository.js";
import type { ActionConnectorChatRequest } from "./runtime.js";
import type { ActionDescriptor, ConnectorActionRequest, ConnectorIdentity } from "./client.js";

export const ACTION_CONNECTOR_CHANNEL = "action_connector";

export type ActionConnectorRuntimeInstance = {
  id: string;
  name: string;
  slug?: string | null;
  organizationId?: string | null;
};

export type ActionConnectorTurnStatus = "previewed" | "completed" | "failed";

type ConversationStore = Pick<
  ConversationRecordService,
  | "appendMessage"
  | "claimTurnDelivery"
  | "createThread"
  | "finalizeTurnDelivery"
  | "getExternalConversationBinding"
  | "getMessageRepository"
  | "getThread"
  | "touchExternalConversation"
  | "upsertExternalConversation"
>;

type DirectUsageRecorder = Pick<UsageRecorder, "recordDirectUsage">;

export type ActionConnectorRecordTurnInput = {
  connector: ActionConnectorRuntimeInstance;
  displayName: string;
  conversationId: string;
  runId: string;
  callId: string;
  request: ActionConnectorChatRequest;
  identity?: ConnectorIdentity | null;
  selectedAction: ConnectorActionRequest;
  descriptor: ActionDescriptor;
  preview?: unknown;
  result?: unknown;
  summaryText?: string;
  status: ActionConnectorTurnStatus;
  error?: { code?: string; message: string; retryable?: boolean };
};

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function firstTextPart(message: unknown): string | undefined {
  const record = asRecord(message);
  const content = Array.isArray(record?.content) ? record.content : [];
  for (const part of content) {
    const item = asRecord(part);
    const text = trimOrUndefined(item?.text);
    if (text) return text;
  }
  return trimOrUndefined(record?.text);
}

function messageId(message: unknown): string | undefined {
  return trimOrUndefined(asRecord(message)?.id);
}

function findLatestMatchingUserMessageId(repository: { messages: StoredMessageItem[] }, message: string): string | undefined {
  const normalized = message.trim();
  for (const item of [...repository.messages].reverse()) {
    const record = asRecord(item.message);
    if (trimOrUndefined(record?.role) !== "user") continue;
    if (firstTextPart(item.message) !== normalized) continue;
    const id = messageId(item.message);
    if (id) return id;
  }
  return undefined;
}

function summarizeText(value: unknown, max = 96): string {
  const text = trimOrUndefined(value) ?? "";
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function connectorConversationKey(input: { connectorId: string; conversationId: string }): string {
  return `${ACTION_CONNECTOR_CHANNEL}:${input.connectorId}:${input.conversationId}`;
}

function connectorThreadExternalId(externalConversationKey: string): string {
  return `${externalConversationKey}:thread`;
}

function actionConnectorMessage(input: {
  id: string;
  role: "user" | "assistant";
  text: string;
  status?: { type: "completed" | "error"; reason?: string };
  metadata?: Record<string, unknown>;
  contentParts?: Record<string, unknown>[];
}) {
  return {
    id: input.id,
    role: input.role,
    content: [
      {
        type: "text",
        text: input.text
      },
      ...(input.contentParts ?? [])
    ],
    createdAt: new Date().toISOString(),
    status: input.status ?? { type: "completed" },
    ...(input.metadata ? { metadata: input.metadata } : {})
  };
}

function traceBatchPart(input: ActionConnectorRecordTurnInput): Record<string, unknown> {
  const rows: Record<string, unknown>[] = [
    {
      id: `${input.callId}-selected`,
      kind: "tool",
      title: `Selected action · ${input.selectedAction.actionId}`,
      detail: {
        actionId: input.selectedAction.actionId,
        input: input.selectedAction.input ?? {},
        risk: input.descriptor.risk
      },
      at: new Date().toISOString()
    }
  ];

  if (input.preview !== undefined) {
    rows.push({
      id: `${input.callId}-preview`,
      kind: "process",
      title: "Action preview",
      detail: input.preview,
      at: new Date().toISOString()
    });
  }

  if (input.result !== undefined) {
    rows.push({
      id: `${input.callId}-result`,
      kind: input.status === "completed" ? "done" : "error",
      title: "Action result",
      detail: input.result,
      at: new Date().toISOString()
    });
  }

  if (input.error) {
    rows.push({
      id: `${input.callId}-error`,
      kind: "error",
      title: "Action connector error",
      detail: input.error,
      at: new Date().toISOString()
    });
  }

  return {
    type: "data",
    name: "codex_trace_batch",
    data: { rows }
  };
}

function assistantText(input: ActionConnectorRecordTurnInput): string {
  if (input.status === "failed") {
    return input.error?.message || "Action connector runtime failed.";
  }
  if (input.status === "previewed") {
    const preview = asRecord(input.preview);
    const summary = trimOrUndefined(preview?.summary) ?? input.descriptor.description ?? input.selectedAction.actionId;
    return `Action preview generated: ${summary}`;
  }
  return trimOrUndefined(input.summaryText) ?? "Action connector returned a result.";
}

function identityMetadata(identity?: ConnectorIdentity | null): Record<string, unknown> | undefined {
  if (!identity) return undefined;
  return {
    ...(identity.organizationId ? { organizationId: identity.organizationId } : {}),
    ...(identity.scopes?.length ? { scopes: identity.scopes } : {}),
    ...(identity.roles?.length ? { roles: identity.roles } : {}),
    ...(identity.metadata ? { metadata: identity.metadata } : {})
  };
}

export class ActionConnectorConversationRecorder {
  constructor(
    private readonly deps: {
      conversations: ConversationStore;
      usageRecorder?: DirectUsageRecorder;
    }
  ) {}

  async recordTurn(input: ActionConnectorRecordTurnInput): Promise<{ threadId: string }> {
    const acceptedAt = new Date().toISOString();
    const organizationId = trimOrUndefined(input.connector.organizationId ?? undefined);
    const externalConversationKey = connectorConversationKey({
      connectorId: input.connector.id,
      conversationId: input.conversationId
    });
    const binding = await this.deps.conversations.getExternalConversationBinding(externalConversationKey);
    let thread: ThreadRecord | undefined = binding
      ? await this.deps.conversations.getThread(binding.threadId, organizationId)
      : undefined;

    if (!thread) {
      const titlePrefix = trimOrUndefined(input.displayName) ?? input.connector.name;
      const pageTitle = trimOrUndefined(asRecord(input.request.context)?.title);
      thread = await this.deps.conversations.createThread({
        id: randomUUID().replace(/-/g, ""),
        organizationId,
        title: `${titlePrefix}: ${summarizeText(pageTitle || input.request.message, 72)}`,
        externalId: connectorThreadExternalId(externalConversationKey),
        model: "action-connector",
        reasoningEffort: "none",
        workspace: "external-action-connector",
        codexRunConfig: {
          channel: ACTION_CONNECTOR_CHANNEL,
          integrationInstanceId: input.connector.id,
          externalConversationKey,
          conversationType: "embedded_agent"
        }
      });
    }

    const externalUserId =
      trimOrUndefined(input.identity?.externalUserId) ??
      trimOrUndefined(input.identity?.externalUnionId);
    const externalUserName = trimOrUndefined(input.identity?.externalUserName);

    await this.deps.conversations.upsertExternalConversation({
      organizationId: organizationId ?? null,
      integrationInstanceId: input.connector.id,
      threadId: thread.id,
      userId: null,
      channel: ACTION_CONNECTOR_CHANNEL,
      externalConversationKey,
      externalConversationId: input.conversationId,
      conversationType: "embedded_agent",
      externalUserId,
      externalUnionId: trimOrUndefined(input.identity?.externalUnionId),
      externalUserName,
      botName: input.displayName || input.connector.name,
      lastExternalMessageId: input.runId,
      lastMessageAt: new Date(),
      metadata: {
        integrationSlug: trimOrUndefined(input.connector.slug ?? undefined),
        sourcePath: trimOrUndefined(asRecord(input.request.context)?.path),
        sourceTitle: trimOrUndefined(asRecord(input.request.context)?.title),
        locale: input.request.locale,
        timezone: input.request.timezone,
        externalIdentity: identityMetadata(input.identity) ?? null
      }
    });

    const repository = await this.deps.conversations.getMessageRepository(thread.id);
    const knownMessageIds = new Set(repository.messages.map((item) => messageId(item.message)).filter(Boolean));
    let parentId = thread.headId && knownMessageIds.has(thread.headId) ? thread.headId : null;
    if (!parentId) {
      for (const item of [...repository.messages].reverse()) {
        const existingMessageId = messageId(item.message);
        if (!existingMessageId) continue;
        parentId = existingMessageId;
        break;
      }
    }
    let userMessageId = input.request.approvedAction
      ? findLatestMatchingUserMessageId(repository, input.request.message)
      : undefined;

    if (!userMessageId) {
      userMessageId = `${ACTION_CONNECTOR_CHANNEL}-user-${input.runId}`;
      const updated = await this.deps.conversations.appendMessage({
        threadId: thread.id,
        parentId,
        message: actionConnectorMessage({
          id: userMessageId,
          role: "user",
          text: input.request.message,
          metadata: {
            channel: ACTION_CONNECTOR_CHANNEL,
            integrationInstanceId: input.connector.id,
            externalConversationKey,
            conversationId: input.conversationId,
            runId: input.runId,
            externalUserId,
            externalUserName
          }
        }),
        runConfig: {
          channel: ACTION_CONNECTOR_CHANNEL,
          integrationInstanceId: input.connector.id,
          externalConversationKey,
          conversationType: "embedded_agent",
          runId: input.runId
        }
      });
      thread = updated;
      parentId = userMessageId;
    } else {
      parentId = userMessageId;
    }
    const claim = await this.deps.conversations.claimTurnDelivery({
      threadId: thread.id,
      userMessageId,
      runId: input.runId,
      channel: ACTION_CONNECTOR_CHANNEL,
      acceptedAt
    });
    if (claim.outcome === "superseded") {
      return { threadId: thread.id };
    }

    await this.deps.conversations.finalizeTurnDelivery({
      threadId: thread.id,
      userMessageId,
      runId: input.runId,
      channel: ACTION_CONNECTOR_CHANNEL,
      acceptedAt,
      status: input.status === "failed" ? "failed" : "completed",
      assistant: {
        parentId,
        message: actionConnectorMessage({
          id: `${ACTION_CONNECTOR_CHANNEL}-assistant-${input.runId}`,
          role: "assistant",
          text: assistantText(input),
          status: input.status === "failed" ? { type: "error", reason: "error" } : { type: "completed" },
          contentParts: [traceBatchPart(input)],
          metadata: {
            channel: ACTION_CONNECTOR_CHANNEL,
            integrationInstanceId: input.connector.id,
            externalConversationKey,
            conversationId: input.conversationId,
            runId: input.runId,
            callId: input.callId,
            actionId: input.selectedAction.actionId,
            actionStatus: input.status,
            externalUserId,
            externalUserName
          }
        }),
        runConfig: {
          channel: ACTION_CONNECTOR_CHANNEL,
          integrationInstanceId: input.connector.id,
          externalConversationKey,
          conversationType: "embedded_agent",
          runId: input.runId,
          actionId: input.selectedAction.actionId,
          status: input.status
        }
      }
    });

    await this.deps.conversations.touchExternalConversation({
      externalConversationKey,
      lastExternalMessageId: input.runId,
      lastMessageAt: new Date(),
      metadata: {
        integrationSlug: trimOrUndefined(input.connector.slug ?? undefined),
        lastRunId: input.runId,
        lastActionId: input.selectedAction.actionId,
        lastActionStatus: input.status,
        externalIdentity: identityMetadata(input.identity) ?? null
      }
    });

    await this.deps.usageRecorder?.recordDirectUsage({
      organizationId,
      threadId: thread.id,
      model: "action-connector",
      featureType: ACTION_CONNECTOR_CHANNEL,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      resultStatus: input.status === "failed" ? "failed" : "success",
      metadata: {
        integrationInstanceId: input.connector.id,
        externalConversationKey,
        conversationId: input.conversationId,
        runId: input.runId,
        actionId: input.selectedAction.actionId,
        actionStatus: input.status,
        externalUserId,
        externalUserName
      }
    });

    return { threadId: thread.id };
  }
}
