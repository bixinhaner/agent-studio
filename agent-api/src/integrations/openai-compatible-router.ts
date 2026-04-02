import { randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";

import { resolveWorkspaceAgentsMdContent } from "../agent-mode/workspace-agents-md.js";
import type { ReasoningEffort } from "../model-config.js";
import { REASONING_EFFORT_VALUES, normalizeModel, normalizeReasoningEffortForModel } from "../model-config.js";
import { extractRuntimeUsageFromStreamEvent } from "../live-runtime-session.js";

const OPENAI_COMPATIBLE_API_TYPE = "openai_compatible_api";
const MANAGED_UPLOAD_SOURCE_TYPE = "managed_upload";

type IntegrationInstanceRow = {
  id: string;
  organizationId: string | null;
  type: string;
  slug: string;
  name: string;
  status: string;
};

type IntegrationInstanceConfigRow = {
  integrationInstanceId: string;
  config: unknown;
};

type IntegrationInstanceSecretRow = {
  integrationInstanceId: string;
  secretState: unknown;
};

type AgentModeRecord = {
  id: string;
  name: string;
  status: string;
  runProfileId: string;
  instructionSources: Array<{
    sourceType: string;
    sourceRef: string;
  }>;
};

type RunProfileRecord = {
  id: string;
  status: string;
  defaultModel: string;
  allowedModels: string[];
  defaultReasoningEffort: string;
  sandboxMode: string;
  approvalPolicy: string;
  networkAccessEnabled: boolean;
  webSearchMode: string;
};

type KnowledgeSetRecord = {
  id: string;
  name: string;
  slug: string;
  status: string;
  sourceType: string;
};

type RuntimeStreamEvent = {
  type?: string;
  delta?: string;
  text?: string;
  raw?: unknown;
  usage?: unknown;
};

type ChatCompletionMessage = {
  role: string;
  content: unknown;
  name?: string;
  tool_call_id?: string;
};

type OpenAICompatibleApiConfig = {
  agentModeId?: string;
  knowledgeSetIds: string[];
};

type AuthenticatedIntegration = {
  instance: IntegrationInstanceRow;
  config: OpenAICompatibleApiConfig;
};

type OpenAICompatibleRouterOptions = {
  runtime: {
    startThreadWithOptions(options: {
      model: string;
      reasoningEffort: ReasoningEffort;
      workspace: string;
      codexRunConfig?: Record<string, unknown>;
    }): Promise<unknown>;
    runStreamed(thread: unknown, message: string): AsyncGenerator<RuntimeStreamEvent>;
  };
  integrationsDb: {
    integrationInstance: {
      findMany(args: {
        where?: {
          type?: string;
          status?: string;
        };
      }): Promise<IntegrationInstanceRow[]>;
    };
    integrationInstanceConfig: {
      findMany(args: {
        where?: {
          integrationInstanceId?: {
            in?: string[];
          };
        };
      }): Promise<IntegrationInstanceConfigRow[]>;
    };
    integrationInstanceSecret: {
      findMany(args: {
        where?: {
          integrationInstanceId?: {
            in?: string[];
          };
        };
      }): Promise<IntegrationInstanceSecretRow[]>;
    };
  };
  agentModes: {
    get(id: string): Promise<AgentModeRecord | undefined>;
  };
  runProfiles: {
    get(id: string): Promise<RunProfileRecord | undefined>;
  };
  knowledgeSets: {
    list(): Promise<KnowledgeSetRecord[]>;
  };
  knowledgeSetStorage: {
    resolveReadableMountPath(knowledgeSetId: string): string;
  };
  usageIngestion?: {
    record(input: {
      organizationId?: string;
      sessionId?: string;
      model: string;
      featureType: string;
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
      resultStatus?: string;
      metadata?: unknown;
    }): Promise<unknown>;
  };
  sessionWorkspaceRoot: string;
  defaultModel: string;
  defaultReasoningEffort: ReasoningEffort;
};

const chatCompletionRequestSchema = z.object({
  model: z.string().trim().optional(),
  messages: z.array(
    z.object({
      role: z.string().trim().min(1),
      content: z.unknown(),
      name: z.string().trim().optional(),
      tool_call_id: z.string().trim().optional()
    }).passthrough()
  ).min(1),
  stream: z.boolean().optional(),
  reasoning_effort: z.enum(REASONING_EFFORT_VALUES).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
}).passthrough();

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return trimOrUndefined(typeof value === "string" ? value : undefined);
}

function asReasoningEffort(value: unknown): ReasoningEffort | undefined {
  const normalized = asString(value);
  if (!normalized) return undefined;
  return REASONING_EFFORT_VALUES.includes(normalized as ReasoningEffort)
    ? (normalized as ReasoningEffort)
    : undefined;
}

function normalizeIdList(value: unknown): string[] {
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

function normalizeAdditionalDirectories(value: unknown): string[] {
  return normalizeIdList(value);
}

function mergeAdditionalDirectories(
  codexRunConfig: Record<string, unknown> | undefined,
  additionalDirectories: string[]
): Record<string, unknown> | undefined {
  if (!codexRunConfig && additionalDirectories.length === 0) return codexRunConfig;
  const next: Record<string, unknown> = codexRunConfig ? { ...codexRunConfig } : {};
  const merged = normalizeAdditionalDirectories(next.additionalDirectories);
  const seen = new Set(merged);
  for (const directory of additionalDirectories) {
    if (!seen.has(directory)) {
      seen.add(directory);
      merged.push(directory);
    }
  }
  next.additionalDirectories = merged;
  return next;
}

function parseApiKeyFromAuthorizationHeader(value: string | undefined): string | undefined {
  const auth = trimOrUndefined(value);
  if (!auth) return undefined;
  if (!auth.toLowerCase().startsWith("bearer ")) return undefined;
  return trimOrUndefined(auth.slice(7));
}

function safeTokenMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function parseConfig(value: unknown): OpenAICompatibleApiConfig {
  const record = asRecord(value) ?? {};
  const agentModeId = asString(record.agentModeId) || asString(record.defaultAgentModeId);
  const knowledgeSetIds =
    normalizeIdList(record.knowledgeSetIds).length > 0
      ? normalizeIdList(record.knowledgeSetIds)
      : normalizeIdList(record.defaultKnowledgeSetIds);

  return {
    agentModeId,
    knowledgeSetIds
  };
}

function parseSecretApiKey(value: unknown): string | undefined {
  const record = asRecord(value);
  return record ? asString(record.apiKey) : undefined;
}

function parseMessageContent(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";

  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const record = part as Record<string, unknown>;
      const partType = asString(record.type);
      if (partType === "text" || partType === "input_text" || partType === "output_text") {
        return asString(record.text) ?? "";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function buildPrompt(messages: ChatCompletionMessage[]): string {
  const instructionBlocks = messages
    .filter((message) => message.role === "system" || message.role === "developer")
    .map((message, index) => {
      const content = parseMessageContent(message.content);
      if (!content) return "";
      return `Instruction ${index + 1} (${message.role}):\n${content}`;
    })
    .filter(Boolean);

  const conversationBlocks = messages
    .filter((message) => message.role !== "system" && message.role !== "developer")
    .map((message, index) => {
      const content = parseMessageContent(message.content);
      if (!content) return "";
      const name = trimOrUndefined(message.name);
      const toolCallId = trimOrUndefined(message.tool_call_id);
      const labelParts = [message.role];
      if (name) labelParts.push(`name=${name}`);
      if (toolCallId) labelParts.push(`tool_call_id=${toolCallId}`);
      return `${index + 1}. ${labelParts.join(" ")}\n${content}`;
    })
    .filter(Boolean);

  const sections = [];
  if (instructionBlocks.length > 0) {
    sections.push(`Follow these instructions:\n\n${instructionBlocks.join("\n\n")}`);
  }
  if (conversationBlocks.length > 0) {
    sections.push(`Conversation:\n\n${conversationBlocks.join("\n\n")}`);
  }
  sections.push("Respond as the assistant to the latest user request.");
  return sections.join("\n\n").trim();
}

function dateSegment(now = new Date()): string {
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sanitizePathSegment(value: string, fallback: string): string {
  const normalized = value
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function writeOpenAIError(
  res: Response,
  status: number,
  message: string,
  code?: string
): void {
  res.status(status).json({
    error: {
      message,
      type: "invalid_request_error",
      param: null,
      code: code ?? null
    }
  });
}

async function resolveAuthenticatedIntegration(
  db: OpenAICompatibleRouterOptions["integrationsDb"],
  apiKey: string
): Promise<AuthenticatedIntegration | undefined> {
  const instances = await db.integrationInstance.findMany({
    where: {
      type: OPENAI_COMPATIBLE_API_TYPE,
      status: "active"
    }
  });
  if (instances.length === 0) return undefined;

  const instanceIds = instances.map((item) => item.id);
  const [configRows, secretRows] = await Promise.all([
    db.integrationInstanceConfig.findMany({ where: { integrationInstanceId: { in: instanceIds } } }),
    db.integrationInstanceSecret.findMany({ where: { integrationInstanceId: { in: instanceIds } } })
  ]);

  const configById = new Map(configRows.map((row) => [row.integrationInstanceId, row] as const));
  const secretById = new Map(secretRows.map((row) => [row.integrationInstanceId, row] as const));

  for (const instance of instances) {
    const secretApiKey = parseSecretApiKey(secretById.get(instance.id)?.secretState);
    if (!secretApiKey || !safeTokenMatch(secretApiKey, apiKey)) {
      continue;
    }
    return {
      instance,
      config: parseConfig(configById.get(instance.id)?.config)
    };
  }

  return undefined;
}

async function applyWorkspaceAgentsMdForMode(
  agentModes: OpenAICompatibleRouterOptions["agentModes"],
  modeId: string,
  workspacePath: string
): Promise<void> {
  const mode = await agentModes.get(modeId);
  if (!mode) return;
  const source = mode.instructionSources.find((item) => item.sourceType === "workspace_agents_md" && trimOrUndefined(item.sourceRef));
  if (!source) return;
  const content = await resolveWorkspaceAgentsMdContent(source.sourceRef);
  if (!content) return;
  await fs.writeFile(path.join(workspacePath, "AGENTS.md"), content, "utf8");
}

function buildChatCompletionResponse(input: {
  id: string;
  created: number;
  model: string;
  text: string;
  usage?: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
  };
}) {
  return {
    id: input.id,
    object: "chat.completion",
    created: input.created,
    model: input.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: input.text
        },
        finish_reason: "stop"
      }
    ],
    usage: input.usage
      ? {
          prompt_tokens: input.usage.inputTokens,
          completion_tokens: input.usage.outputTokens,
          total_tokens: input.usage.inputTokens + input.usage.outputTokens,
          prompt_tokens_details: {
            cached_tokens: input.usage.cachedInputTokens
          }
        }
      : undefined
  };
}

function writeOpenAIStreamChunk(res: Response, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function buildExternalApiUsageMetadata(input: {
  authenticated: AuthenticatedIntegration;
  agentModeId?: string;
  knowledgeSetIds: string[];
  body?: z.infer<typeof chatCompletionRequestSchema>;
  selectedModel?: string;
  selectedReasoningEffort?: ReasoningEffort;
  errorMessage?: string;
}) {
  return {
    source: OPENAI_COMPATIBLE_API_TYPE,
    integrationInstanceId: input.authenticated.instance.id,
    integrationSlug: input.authenticated.instance.slug,
    agentModeId: input.agentModeId,
    knowledgeSetIds: input.knowledgeSetIds,
    requestedModel: trimOrUndefined(input.body?.model),
    requestedReasoningEffort: input.body?.reasoning_effort,
    selectedModel: input.selectedModel,
    selectedReasoningEffort: input.selectedReasoningEffort,
    stream: Boolean(input.body?.stream),
    messageCount: input.body?.messages.length ?? 0,
    errorMessage: trimOrUndefined(input.errorMessage)
  };
}

async function buildModelList(
  authenticated: AuthenticatedIntegration,
  runProfiles: OpenAICompatibleRouterOptions["runProfiles"],
  agentModes: OpenAICompatibleRouterOptions["agentModes"],
  defaultModel: string
): Promise<string[]> {
  const configuredModeId = trimOrUndefined(authenticated.config.agentModeId);
  if (!configuredModeId) {
    return [normalizeModel(defaultModel)];
  }
  const mode = await agentModes.get(configuredModeId);
  if (!mode || trimOrUndefined(mode.status) !== "active") {
    return [normalizeModel(defaultModel)];
  }
  const runProfile = await runProfiles.get(mode.runProfileId);
  if (!runProfile || trimOrUndefined(runProfile.status) !== "active") {
    return [normalizeModel(defaultModel)];
  }
  return [normalizeModel(runProfile.defaultModel || defaultModel)];
}

export function createOpenAICompatibleRouter(options: OpenAICompatibleRouterOptions): Router {
  const router = express.Router();

  router.use(async (req: Request, res: Response, next) => {
    const apiKey = parseApiKeyFromAuthorizationHeader(req.header("authorization"));
    if (!apiKey) {
      writeOpenAIError(res, 401, "Missing Bearer token.", "invalid_api_key");
      return;
    }

    try {
      const authenticated = await resolveAuthenticatedIntegration(options.integrationsDb, apiKey);
      if (!authenticated) {
        writeOpenAIError(res, 401, "Invalid API key provided.", "invalid_api_key");
        return;
      }
      (req as Request & { authenticatedIntegration?: AuthenticatedIntegration }).authenticatedIntegration = authenticated;
      next();
    } catch (error) {
      writeOpenAIError(res, 500, error instanceof Error ? error.message : "Failed to resolve integration.", "server_error");
    }
  });

  router.get("/models", async (req: Request, res: Response) => {
    const authenticated = (req as Request & { authenticatedIntegration?: AuthenticatedIntegration }).authenticatedIntegration;
    if (!authenticated) {
      writeOpenAIError(res, 401, "Invalid API key provided.", "invalid_api_key");
      return;
    }

    try {
      const models = await buildModelList(authenticated, options.runProfiles, options.agentModes, options.defaultModel);
      const created = Math.floor(Date.now() / 1000);
      res.json({
        object: "list",
        data: models.map((model) => ({
          id: model,
          object: "model",
          created,
          owned_by: authenticated.instance.slug
        }))
      });
    } catch (error) {
      writeOpenAIError(res, 400, error instanceof Error ? error.message : "Failed to list models.", "invalid_request");
    }
  });

  router.post("/chat/completions", async (req: Request, res: Response) => {
    const authenticated = (req as Request & { authenticatedIntegration?: AuthenticatedIntegration }).authenticatedIntegration;
    if (!authenticated) {
      writeOpenAIError(res, 401, "Invalid API key provided.", "invalid_api_key");
      return;
    }

    let workspacePath = "";
    const completionId = `chatcmpl_${randomUUID().replace(/-/g, "")}`;
    const created = Math.floor(Date.now() / 1000);
    let body: z.infer<typeof chatCompletionRequestSchema> | undefined;
    let selectedAgentModeId: string | undefined;
    let selectedKnowledgeSetIds: string[] = [];
    let selectedModel: string | undefined;
    let selectedReasoningEffort: ReasoningEffort | undefined;

    try {
      body = chatCompletionRequestSchema.parse(req.body ?? {});
      selectedAgentModeId = trimOrUndefined(authenticated.config.agentModeId);
      if (!selectedAgentModeId) {
        throw new Error("当前外部接口实例未配置 Agent Mode。");
      }

      const agentMode = await options.agentModes.get(selectedAgentModeId);
      if (!agentMode || trimOrUndefined(agentMode.status) !== "active") {
        throw new Error("当前外部接口实例绑定的 Agent Mode 不存在或未启用。");
      }

      const runProfile = await options.runProfiles.get(agentMode.runProfileId);
      if (!runProfile || trimOrUndefined(runProfile.status) !== "active") {
        throw new Error("Agent Mode 对应的 Run Profile 不存在或未启用。");
      }

      selectedModel = normalizeModel(runProfile.defaultModel || options.defaultModel);
      selectedReasoningEffort = normalizeReasoningEffortForModel(
        selectedModel,
        (runProfile.defaultReasoningEffort as ReasoningEffort | undefined) || options.defaultReasoningEffort
      );
      selectedKnowledgeSetIds = authenticated.config.knowledgeSetIds;

      const knowledgeSetMap = new Map(
        (await options.knowledgeSets.list())
          .filter((item) => trimOrUndefined(item.status) === "active" && trimOrUndefined(item.sourceType) === MANAGED_UPLOAD_SOURCE_TYPE)
          .map((item) => [item.id, item] as const)
      );
      for (const knowledgeSetId of selectedKnowledgeSetIds) {
        if (!knowledgeSetMap.has(knowledgeSetId)) {
          throw new Error("当前外部接口实例绑定的资料集不存在或未启用。");
        }
      }

      const mountPaths = selectedKnowledgeSetIds.map((knowledgeSetId) => options.knowledgeSetStorage.resolveReadableMountPath(knowledgeSetId));
      const workspaceBase = path.join(
        options.sessionWorkspaceRoot,
        "external-openai",
        sanitizePathSegment(authenticated.instance.slug, "instance"),
        dateSegment()
      );
      workspacePath = path.join(workspaceBase, `request-${sanitizePathSegment(completionId, "completion")}`);
      await fs.mkdir(workspacePath, { recursive: true });
      await applyWorkspaceAgentsMdForMode(options.agentModes, selectedAgentModeId, workspacePath);

      const codexRunConfig = mergeAdditionalDirectories(
        {
          sandboxMode: runProfile.sandboxMode,
          approvalPolicy: runProfile.approvalPolicy,
          networkAccessEnabled: runProfile.networkAccessEnabled,
          webSearchMode: runProfile.webSearchMode,
          mode: selectedAgentModeId
        },
        mountPaths
      );

      const prompt = buildPrompt(body.messages as ChatCompletionMessage[]);
      const thread = await options.runtime.startThreadWithOptions({
        model: selectedModel,
        reasoningEffort: selectedReasoningEffort,
        workspace: workspacePath,
        codexRunConfig
      });

      if (body.stream) {
        res.status(200);
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders?.();

        let usage:
          | {
              inputTokens: number;
              cachedInputTokens: number;
              outputTokens: number;
            }
          | undefined;

        writeOpenAIStreamChunk(res, {
          id: completionId,
          object: "chat.completion.chunk",
          created,
          model: selectedModel,
          choices: [
            {
              index: 0,
              delta: { role: "assistant" },
              finish_reason: null
            }
          ]
        });

        for await (const event of options.runtime.runStreamed(thread, prompt)) {
          const eventUsage = extractRuntimeUsageFromStreamEvent(event);
          if (eventUsage) {
            usage = eventUsage;
          }
          const delta = event.delta ?? event.text;
          if (!delta) {
            continue;
          }
          writeOpenAIStreamChunk(res, {
            id: completionId,
            object: "chat.completion.chunk",
            created,
            model: selectedModel,
            choices: [
              {
                index: 0,
                delta: { content: delta },
                finish_reason: null
              }
            ]
          });
        }

        writeOpenAIStreamChunk(res, {
          id: completionId,
          object: "chat.completion.chunk",
          created,
          model: selectedModel,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: "stop"
            }
          ]
        });
        res.write("data: [DONE]\n\n");
        res.end();

        if (options.usageIngestion) {
          await options.usageIngestion.record({
            organizationId: trimOrUndefined(authenticated.instance.organizationId),
            sessionId: completionId,
            model: selectedModel,
            featureType: "external_openai_api",
            inputTokens: usage?.inputTokens ?? 0,
            cachedInputTokens: usage?.cachedInputTokens ?? 0,
            outputTokens: usage?.outputTokens ?? 0,
            resultStatus: "success",
            metadata: buildExternalApiUsageMetadata({
              authenticated,
              agentModeId: selectedAgentModeId,
              knowledgeSetIds: selectedKnowledgeSetIds,
              body,
              selectedModel,
              selectedReasoningEffort
            })
          });
        }
        return;
      }

      let answer = "";
      let usage:
        | {
            inputTokens: number;
            cachedInputTokens: number;
            outputTokens: number;
          }
        | undefined;

      for await (const event of options.runtime.runStreamed(thread, prompt)) {
        const eventUsage = extractRuntimeUsageFromStreamEvent(event);
        if (eventUsage) {
          usage = eventUsage;
        }
        if (event.delta) answer += event.delta;
        else if (event.text) answer += event.text;
      }

      if (options.usageIngestion) {
        await options.usageIngestion.record({
          organizationId: trimOrUndefined(authenticated.instance.organizationId),
          sessionId: completionId,
          model: selectedModel,
          featureType: "external_openai_api",
          inputTokens: usage?.inputTokens ?? 0,
          cachedInputTokens: usage?.cachedInputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
          resultStatus: "success",
          metadata: buildExternalApiUsageMetadata({
            authenticated,
            agentModeId: selectedAgentModeId,
            knowledgeSetIds: selectedKnowledgeSetIds,
            body,
            selectedModel,
            selectedReasoningEffort
          })
        });
      }

      res.json(
        buildChatCompletionResponse({
          id: completionId,
          created,
          model: selectedModel,
          text: answer,
          usage
        })
      );
    } catch (error) {
      if (options.usageIngestion) {
        await options.usageIngestion.record({
          organizationId: trimOrUndefined(authenticated.instance.organizationId),
          sessionId: completionId,
          model: selectedModel || normalizeModel(options.defaultModel),
          featureType: "external_openai_api",
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          resultStatus: "failed",
          metadata: buildExternalApiUsageMetadata({
            authenticated,
            agentModeId: selectedAgentModeId,
            knowledgeSetIds: selectedKnowledgeSetIds,
            body,
            selectedModel,
            selectedReasoningEffort,
            errorMessage: error instanceof Error ? error.message : "Invalid request."
          })
        }).catch(() => undefined);
      }
      if (!res.headersSent) {
        writeOpenAIError(res, 400, error instanceof Error ? error.message : "Invalid request.", "invalid_request");
      } else {
        res.end();
      }
    } finally {
      if (workspacePath) {
        await fs.rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  });

  return router;
}
