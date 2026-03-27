import express, { type Request, type Response, type Router } from "express";

import { ZendeskIntegrationService } from "./service.js";
import { zendeskManualRunSchema, zendeskSettingsUpdateSchema } from "./types.js";

function normalizeStringArray(input?: string[]): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  return input.map((item) => String(item || "").trim()).filter(Boolean);
}

export function createZendeskAdminRouter(service: ZendeskIntegrationService): Router {
  const router = express.Router();

  router.get("/overview", async (_req: Request, res: Response) => {
    try {
      res.json(await service.getOverview());
    } catch (error) {
      const detail = error instanceof Error ? error.message : "加载 Zendesk 概览失败";
      res.status(500).json({ detail });
    }
  });

  router.put("/settings", async (req: Request, res: Response) => {
    try {
      const input = zendeskSettingsUpdateSchema.parse(req.body || {});
      const overview = await service.updateSettings({
        enabled: input.enabled,
        publicBaseUrl: input.public_base_url,
        zendeskBaseUrl: input.zendesk_base_url,
        zendeskEmail: input.zendesk_email,
        zendeskApiToken:
          input.zendesk_api_token === undefined ? undefined : String(input.zendesk_api_token || "").trim(),
        webhookSigningSecret:
          input.webhook_signing_secret === undefined ? undefined : String(input.webhook_signing_secret || "").trim(),
        responseMode: input.response_mode,
        fallbackMode: input.fallback_mode,
        autoStatus: input.auto_status,
        excludedTags: normalizeStringArray(input.excluded_tags),
        workspace: input.workspace,
        model: input.model,
        reasoningEffort: input.reasoning_effort,
        sandboxMode: input.sandbox_mode,
        approvalPolicy: input.approval_policy,
        networkAccessEnabled: input.network_access_enabled,
        webSearchMode: input.web_search_mode,
        additionalDirectories: normalizeStringArray(input.additional_directories),
        maxCommentHistory: input.max_comment_history,
        systemPrompt: input.system_prompt
      });
      res.json(overview);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "保存 Zendesk 配置失败";
      res.status(400).json({ detail });
    }
  });

  router.post("/validate", async (_req: Request, res: Response) => {
    try {
      res.json(await service.validateConnection());
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Zendesk 连接验证失败";
      res.status(400).json({ detail });
    }
  });

  router.post("/run", async (req: Request, res: Response) => {
    try {
      const input = zendeskManualRunSchema.parse(req.body || {});
      const result = await service.runTicket(input.ticket_id);
      res.json({ ok: true, result, overview: await service.getOverview() });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Zendesk 手动执行失败";
      res.status(400).json({ detail });
    }
  });

  return router;
}

export async function handleZendeskWebhookRequest(
  service: ZendeskIntegrationService,
  req: Request,
  res: Response
) {
  try {
    const rawBody =
      Buffer.isBuffer(req.body)
        ? req.body.toString("utf8")
        : typeof req.body === "string"
          ? req.body
          : "";
    const result = await service.handleWebhook(rawBody, req.headers);
    res.status(202).json(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Zendesk webhook 处理失败";
    const status = /签名|payload|ticket_id|时间戳/.test(detail) ? 400 : 500;
    res.status(status).json({ detail });
  }
}
