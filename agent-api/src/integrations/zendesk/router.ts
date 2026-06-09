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
      const instanceId =
        typeof _req.query.instance_id === "string" && _req.query.instance_id.trim()
          ? _req.query.instance_id.trim()
          : undefined;
      res.json(instanceId ? await service.getOverview(instanceId) : await service.getOverview());
    } catch (error) {
      const detail = error instanceof Error ? error.message : "加载 Zendesk 概览失败";
      res.status(500).json({ detail });
    }
  });

  router.put("/settings", async (req: Request, res: Response) => {
    try {
      const instanceId =
        typeof req.body?.instance_id === "string" && req.body.instance_id.trim()
          ? req.body.instance_id.trim()
          : undefined;
      const input = zendeskSettingsUpdateSchema.parse(req.body || {});
      const patch = {
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
        agentModeId: input.agent_mode_id,
        knowledgeSetIds: normalizeStringArray(input.knowledge_set_ids),
        workspace: input.workspace,
        model: input.model,
        reasoningEffort: input.reasoning_effort,
        sandboxMode: input.sandbox_mode,
        approvalPolicy: input.approval_policy,
        networkAccessEnabled: input.network_access_enabled,
        webSearchMode: input.web_search_mode,
        additionalDirectories: normalizeStringArray(input.additional_directories),
        maxCommentHistory: input.max_comment_history,
        attachmentReadingEnabled: input.attachment_reading_enabled,
        attachmentTypeRestrictionEnabled: input.attachment_type_restriction_enabled,
        maxAttachmentCount: input.max_attachment_count,
        maxAttachmentBytes: input.max_attachment_bytes,
        allowedAttachmentMimeTypes: normalizeStringArray(input.allowed_attachment_mime_types),
        dingtalkNotificationEnabled: input.dingtalk_notification_enabled,
        dingtalkNotificationManualRunsEnabled: input.dingtalk_notification_manual_runs_enabled,
        dingtalkNotificationWebhookUrl:
          input.dingtalk_notification_webhook_url === undefined ? undefined : String(input.dingtalk_notification_webhook_url || "").trim(),
        dingtalkNotificationRobotSecret:
          input.dingtalk_notification_robot_secret === undefined ? undefined : String(input.dingtalk_notification_robot_secret || "").trim(),
        dingtalkNotificationFallbackUserIds: normalizeStringArray(input.dingtalk_notification_fallback_user_ids),
        dingtalkNotificationTemplate: input.dingtalk_notification_template,
        dingtalkReviewRequiredEnabled: input.dingtalk_review_required_enabled,
        dingtalkReviewDueHours: input.dingtalk_review_due_hours,
        aiReviewEmailReminderEnabled: input.ai_review_email_reminder_enabled,
        aiReviewEmailReminderTime: input.ai_review_email_reminder_time,
        aiReviewEmailReminderTimezone: input.ai_review_email_reminder_timezone,
        aiReviewEmailReminderCcEmails: normalizeStringArray(input.ai_review_email_reminder_cc_emails),
        systemPrompt: input.system_prompt
      };
      const overview = instanceId ? await service.updateSettings(patch, instanceId) : await service.updateSettings(patch);
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
  res: Response,
  instanceId?: string
) {
  try {
    const rawBody =
      Buffer.isBuffer(req.body)
        ? req.body.toString("utf8")
        : typeof req.body === "string"
          ? req.body
          : "";
    const result = await service.handleWebhook(rawBody, req.headers, instanceId);
    res.status(202).json(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Zendesk webhook 处理失败";
    const status = /签名|payload|ticket_id|时间戳/.test(detail) ? 400 : /部署|drain|deploy/i.test(detail) ? 503 : 500;
    res.status(status).json({ detail });
  }
}
