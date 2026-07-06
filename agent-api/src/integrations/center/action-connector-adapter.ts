import { z } from "zod";

import type { IntegrationValidationOutcome } from "./dingtalk-adapter.js";

const pathSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => value.startsWith("/"), "path must start with /");

export const actionConnectorConfigSchema = z.object({
  displayName: z.string().trim().min(1),
  baseUrl: z
    .string()
    .trim()
    .url()
    .transform((value) => value.replace(/\/+$/, "")),
  healthPath: pathSchema.default("/healthz"),
  actionListPath: pathSchema.default("/api/v1/agent-actions/actions"),
  actionSearchPath: pathSchema.default("/api/v1/agent-actions/actions/search"),
  actionDescribePath: pathSchema.default("/api/v1/agent-actions/actions/describe"),
  actionPreviewPath: pathSchema.default("/api/v1/agent-actions/actions/preview"),
  actionExecutePath: pathSchema.default("/api/v1/agent-actions/actions/execute"),
  delegationHeader: z.string().trim().min(1).default("Authorization"),
  policy: z
    .object({
      allowReadActions: z.boolean().default(true),
      allowLowRiskActions: z.boolean().default(false),
      allowHighRiskActions: z.boolean().default(false)
    })
    .default({
      allowReadActions: true,
      allowLowRiskActions: false,
      allowHighRiskActions: false
    })
});

export type ActionConnectorConfig = z.infer<typeof actionConnectorConfigSchema>;

type FetchLike = typeof fetch;

function validationFailed(summary: string, detail: unknown): IntegrationValidationOutcome {
  return { status: "failed", summary, detail };
}

export class ActionConnectorIntegrationAdapter {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

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
    try {
      const response = await this.fetchImpl(`${config.baseUrl}${config.healthPath}`, {
        method: "GET",
        headers: { Accept: "application/json" }
      });
      if (!response.ok) {
        return validationFailed("Action connector health check failed", {
          status: response.status,
          healthPath: config.healthPath
        });
      }
    } catch (error) {
      return validationFailed("Action connector is unreachable", {
        error: error instanceof Error ? error.message : "network error",
        healthPath: config.healthPath
      });
    }

    return {
      status: "success",
      summary: "Action connector connection validated",
      detail: {
        displayName: config.displayName,
        baseUrl: config.baseUrl,
        actionPaths: {
          list: config.actionListPath,
          search: config.actionSearchPath,
          describe: config.actionDescribePath,
          preview: config.actionPreviewPath,
          execute: config.actionExecutePath
        },
        policy: config.policy
      }
    };
  }
}

