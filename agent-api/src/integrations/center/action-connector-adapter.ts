import { z } from "zod";

import type { IntegrationValidationOutcome } from "./dingtalk-adapter.js";
import { DEFAULT_ACTION_CONNECTOR_RUNTIME_PROMPT } from "../action-connector/default-prompt.js";

export const actionConnectorConfigSchema = z.object({
  displayName: z.string().trim().min(1),
  agentModeId: z.string().trim().min(1).default("default"),
  runtimePrompt: z.string().trim().max(24000).default(DEFAULT_ACTION_CONNECTOR_RUNTIME_PROMPT),
  policy: z
    .object({
      allowReadActions: z.boolean().default(true),
      allowLowRiskActions: z.boolean().default(false),
      allowHighRiskActions: z.boolean().default(false),
      allowedMethods: z.array(z.string().trim().min(1)).default(["GET"]),
      blockedPathPrefixes: z.array(z.string().trim().min(1)).default([]),
      toolTimeoutSeconds: z.number().int().positive().max(300).default(30),
      maxResponseBytes: z.number().int().positive().max(4 * 1024 * 1024).default(262144)
    })
    .default({
      allowReadActions: true,
      allowLowRiskActions: false,
      allowHighRiskActions: false,
      allowedMethods: ["GET"],
      blockedPathPrefixes: [],
      toolTimeoutSeconds: 30,
      maxResponseBytes: 262144
    })
});

export type ActionConnectorConfig = z.infer<typeof actionConnectorConfigSchema>;

function validationFailed(summary: string, detail: unknown): IntegrationValidationOutcome {
  return { status: "failed", summary, detail };
}

export class ActionConnectorIntegrationAdapter {
  async validate(input: Record<string, unknown>): Promise<IntegrationValidationOutcome> {
    const parsed = actionConnectorConfigSchema.safeParse(input);
    if (!parsed.success) {
      return validationFailed("Action connector configuration is incomplete", {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      });
    }

    const config = parsed.data;

    return {
      status: "success",
      summary: "Action connector configuration validated",
      detail: {
        displayName: config.displayName,
        executionMode: "outbound_tool_bridge",
        agentModeId: config.agentModeId,
        policy: config.policy
      }
    };
  }
}
