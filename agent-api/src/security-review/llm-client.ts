import type { ManagedCodexProviderSnapshot } from "../managed-codex-provider.js";
import type { SystemSettingsConversationSecurityReview } from "../system-settings/types.js";

export type SecurityReviewLlmUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

export type SecurityReviewLlmResult = {
  text: string;
  provider: string;
  model: string;
  usage: SecurityReviewLlmUsage;
};

type ResolvedLlmConfig = {
  provider: "openai" | "openai_compatible" | "azure_openai";
  apiMode: "auto" | "responses" | "chat_completions";
  baseUrl: string;
  apiKey: string;
  model: string;
  azureApiVersion?: string;
  reasoningEffort: string;
};

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

function text(value: unknown): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
}

function responseText(value: unknown): string | undefined {
  const root = record(value);
  const direct = text(root?.output_text);
  if (direct) return direct;
  const parts: string[] = [];
  for (const item of Array.isArray(root?.output) ? root.output : []) {
    for (const part of Array.isArray(record(item)?.content) ? record(item)?.content as unknown[] : []) {
      const content = record(part);
      const partText = text(content?.text) ?? text(content?.content);
      if (partText) parts.push(partText);
    }
  }
  const firstChoice = record((Array.isArray(root?.choices) ? root.choices : [])[0]);
  const chatText = text(record(firstChoice?.message)?.content);
  if (chatText) parts.push(chatText);
  return text(parts.join("\n"));
}

function usageFromResponse(value: unknown): SecurityReviewLlmUsage {
  const root = record(value);
  const usage = record(root?.usage);
  const inputTokens = number(usage?.input_tokens ?? usage?.prompt_tokens);
  const outputTokens = number(usage?.output_tokens ?? usage?.completion_tokens);
  const inputDetails = record(usage?.input_tokens_details ?? usage?.prompt_tokens_details);
  return {
    inputTokens,
    cachedInputTokens: Math.min(inputTokens, number(inputDetails?.cached_tokens)),
    outputTokens
  };
}

function resolveApiKey(envName: string): string | undefined {
  const normalized = text(envName);
  return normalized ? text(process.env[normalized]) : undefined;
}

export function resolveSecurityReviewLlmConfig(
  settings: SystemSettingsConversationSecurityReview,
  snapshot: ManagedCodexProviderSnapshot
): ResolvedLlmConfig {
  const model = text(settings.llmModel) ?? snapshot.config.defaultModel;
  const configuredKey = resolveApiKey(settings.llmApiKeyEnv);
  if (settings.llmProvider === "active_codex_provider") {
    const apiKey = snapshot.secrets.apiKey ?? configuredKey;
    if (!apiKey) {
      throw new Error("活动 Codex Provider 没有可用于直接 LLM 调用的 API Key；请改用 Codex Runtime 或配置 LLM Provider");
    }
    if (snapshot.kind === "azure_openai") {
      const baseUrl = text(settings.llmBaseUrl) ?? text(snapshot.config.baseUrl);
      if (!baseUrl) throw new Error("Azure OpenAI Base URL 未配置");
      return {
        provider: "azure_openai",
        apiMode: settings.llmApiMode,
        baseUrl,
        apiKey,
        model,
        azureApiVersion: text(settings.llmAzureApiVersion) ?? text(snapshot.config.azureApiVersion),
        reasoningEffort: settings.reasoningEffort
      };
    }
    return {
      provider: snapshot.kind === "openai_api" && snapshot.config.baseUrl ? "openai_compatible" : "openai",
      apiMode: settings.llmApiMode,
      baseUrl: text(settings.llmBaseUrl) ?? text(snapshot.config.baseUrl) ?? DEFAULT_OPENAI_BASE_URL,
      apiKey,
      model,
      reasoningEffort: settings.reasoningEffort
    };
  }

  const apiKey = configuredKey;
  if (!apiKey) throw new Error(`环境变量 ${settings.llmApiKeyEnv || "(未配置)"} 中没有 LLM API Key`);
  if (settings.llmProvider === "azure_openai") {
    const baseUrl = text(settings.llmBaseUrl);
    if (!baseUrl) throw new Error("Azure OpenAI Base URL 未配置");
    return {
      provider: "azure_openai",
      apiMode: settings.llmApiMode,
      baseUrl,
      apiKey,
      model,
      azureApiVersion: text(settings.llmAzureApiVersion),
      reasoningEffort: settings.reasoningEffort
    };
  }
  return {
    provider: settings.llmProvider === "openai_compatible" ? "openai_compatible" : "openai",
    apiMode: settings.llmApiMode,
    baseUrl: text(settings.llmBaseUrl) ?? DEFAULT_OPENAI_BASE_URL,
    apiKey,
    model,
    reasoningEffort: settings.reasoningEffort
  };
}

async function postJson(url: string, headers: Record<string, string>, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`安全审核 LLM 返回 ${response.status}: ${detail.slice(0, 500)}`);
  }
  return await response.json();
}

function chatBody(config: ResolvedLlmConfig, prompt: string): Record<string, unknown> {
  return {
    model: config.model,
    messages: [
      {
        role: "user",
        content: prompt
      }
    ],
    response_format: { type: "json_object" }
  };
}

async function callResponses(config: ResolvedLlmConfig, prompt: string): Promise<unknown> {
  return postJson(
    `${config.baseUrl.replace(/\/+$/, "")}/responses`,
    { authorization: `Bearer ${config.apiKey}` },
    {
      model: config.model,
      input: prompt,
      reasoning: { effort: config.reasoningEffort }
    }
  );
}

export async function callSecurityReviewLlm(
  settings: SystemSettingsConversationSecurityReview,
  snapshot: ManagedCodexProviderSnapshot,
  prompt: string
): Promise<SecurityReviewLlmResult> {
  const config = resolveSecurityReviewLlmConfig(settings, snapshot);
  let json: unknown;
  if (config.provider === "azure_openai") {
    const apiVersion = config.azureApiVersion ?? "2025-04-01-preview";
    json = await postJson(
      `${config.baseUrl.replace(/\/+$/, "")}/deployments/${encodeURIComponent(config.model)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`,
      { "api-key": config.apiKey },
      chatBody(config, prompt)
    );
  } else if (config.apiMode === "responses") {
    json = await callResponses(config, prompt);
  } else if (config.apiMode === "auto") {
    try {
      json = await callResponses(config, prompt);
    } catch (error) {
      if (config.provider === "openai") throw error;
      json = await postJson(
        `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`,
        { authorization: `Bearer ${config.apiKey}` },
        chatBody(config, prompt)
      );
    }
  } else {
    json = await postJson(
      `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`,
      { authorization: `Bearer ${config.apiKey}` },
      chatBody(config, prompt)
    );
  }
  const output = responseText(json);
  if (!output) throw new Error("安全审核 LLM 没有返回文本");
  return {
    text: output,
    provider: settings.llmProvider,
    model: config.model,
    usage: usageFromResponse(json)
  };
}
