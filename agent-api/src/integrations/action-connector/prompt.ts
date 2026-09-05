import type { ActionConnectorConfig } from "../center/action-connector-adapter.js";
import type { ActionConnectorChatRequest } from "./runtime.js";
import { DEFAULT_ACTION_CONNECTOR_RUNTIME_PROMPT } from "./default-prompt.js";

export type ActionConnectorRuntimePromptInput = {
  config: ActionConnectorConfig;
  request: ActionConnectorChatRequest;
  conversationId: string;
  runId: string;
  cliPath: string;
};

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function renderActionConnectorPromptTemplate(
  template: string,
  variables: Record<string, string>
): string {
  let rendered = template;
  for (const [key, value] of Object.entries(variables)) {
    rendered = rendered.replaceAll(`{{${key}}}`, value);
  }
  return rendered;
}

export function buildActionConnectorRuntimePrompt(input: ActionConnectorRuntimePromptInput): string {
  // The builder returns a validated definition; it must not inherit the normal
  // "inspect the system now" action-connector prompt or tool instructions.
  if (input.request.context?.assistantBuilder === true) return input.request.message;
  const approvedAction = input.request.approvedAction
    ? JSON.stringify(input.request.approvedAction, null, 2)
    : "";
  const context = JSON.stringify(input.request.context ?? {}, null, 2);
  const policy = JSON.stringify(input.config.policy, null, 2);
  const approvedActionBlock = approvedAction ? `用户已批准的动作：\n${approvedAction}` : "";
  const template = trimOrUndefined(input.config.runtimePrompt) ?? DEFAULT_ACTION_CONNECTOR_RUNTIME_PROMPT;
  return renderActionConnectorPromptTemplate(template, {
    displayName: input.config.displayName,
    conversationId: input.conversationId,
    runId: input.runId,
    locale: input.request.locale,
    timezone: input.request.timezone,
    mode: input.request.mode,
    policyJson: policy,
    approvedActionJson: approvedAction,
    approvedActionBlock,
    contextJson: context,
    cliPath: input.cliPath,
    cliPathJson: JSON.stringify(input.cliPath),
    message: input.request.message
  });
}
