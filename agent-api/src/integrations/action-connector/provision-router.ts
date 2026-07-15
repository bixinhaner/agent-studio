import express, { type Request, type Response } from "express";
import { z } from "zod";

import { IntegrationInstanceRepository, type IntegrationInstanceRepositoryDb } from "../../persistence/integration-instance-repository.js";
import {
  ActionConnectorIntegrationAdapter,
  actionConnectorConfigSchema,
  type ActionConnectorConfig
} from "../center/action-connector-adapter.js";
import {
  ACTION_CONNECTOR_MAX_ATTACHMENT_BYTES,
  type ActionConnectorAttachmentStore
} from "./attachment-store.js";

const provisionRequestSchema = z.object({
  slug: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).optional().nullable(),
  status: z.enum(["draft", "active", "disabled", "error"]).optional(),
  runtimeBaseUrl: z
    .string()
    .trim()
    .url()
    .transform((value) => value.replace(/\/+$/, ""))
    .optional(),
  config: actionConnectorConfigSchema
});

type ProvisionRequest = z.infer<typeof provisionRequestSchema>;

function detailFromError(error: unknown): string {
  return error instanceof Error ? error.message : "Action connector provision failed";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function runtimeStreamPath(connectorId: string): string {
  return `/api/action-connectors/${encodeURIComponent(connectorId)}/chat/stream`;
}

function runtimeStreamUrl(runtimeBaseUrl: string | undefined, connectorId: string): string {
  const path = runtimeStreamPath(connectorId);
  return runtimeBaseUrl ? `${runtimeBaseUrl}${path}` : path;
}

async function findActionConnectorBySlug(repository: IntegrationInstanceRepository, slug: string) {
  const instances = await repository.listInstances("action_connector");
  return instances.find((instance) => instance.slug === slug) ?? null;
}

function preserveAgentRuntimeConfig(input: {
  existingConfig?: Record<string, unknown>;
  nextConfig: ActionConnectorConfig;
  rawConfig: unknown;
}): ActionConnectorConfig {
  const rawConfig = asRecord(input.rawConfig);
  const config = { ...input.nextConfig };
  if (!hasOwn(rawConfig, "agentModeId")) {
    config.agentModeId = asString(input.existingConfig?.agentModeId) ?? config.agentModeId;
  }
  if (!hasOwn(rawConfig, "runtimePrompt")) {
    config.runtimePrompt = asString(input.existingConfig?.runtimePrompt) ?? config.runtimePrompt;
  }
  return config;
}

async function upsertActionConnector(
  repository: IntegrationInstanceRepository,
  payload: ProvisionRequest,
  rawConfig: unknown
): Promise<{ connectorId: string; config: ActionConnectorConfig }> {
  const existing = await findActionConnectorBySlug(repository, payload.slug);
  const config = existing
    ? preserveAgentRuntimeConfig({
        existingConfig: existing.config,
        nextConfig: payload.config,
        rawConfig
      })
    : payload.config;
  if (existing) {
    await repository.updateInstance(existing.id, {
      name: payload.name,
      description: payload.description ?? null,
      status: payload.status ?? "active"
    });
    await repository.upsertConfig(existing.id, config);
    return { connectorId: existing.id, config };
  }

  const created = await repository.createInstance({
    type: "action_connector",
    slug: payload.slug,
    name: payload.name,
    description: payload.description ?? null,
    status: payload.status ?? "active"
  });
  await repository.upsertConfig(created.id, config);
  return { connectorId: created.id, config };
}

export function createActionConnectorProvisionRouter(options: {
  db: IntegrationInstanceRepositoryDb;
  attachments?: ActionConnectorAttachmentStore;
  getConversationMessages?: (input: {
    connectorId: string;
    externalUserId: string;
    conversationId: string;
  }) => Promise<unknown>;
  cancelRun?: (input: { connectorId: string; externalUserId: string; runId: string }) => Promise<boolean>;
  sendArtifact?: (input: {
    connectorId: string;
    externalUserId: string;
    conversationId: string;
    artifactId: string;
    disposition: "inline" | "attachment";
    response: Response;
  }) => Promise<void>;
}) {
  const router = express.Router();
  const repository = new IntegrationInstanceRepository(options.db);
  const validator = new ActionConnectorIntegrationAdapter();
  const rawAttachment = express.raw({ type: () => true, limit: ACTION_CONNECTOR_MAX_ATTACHMENT_BYTES });

  const externalUserId = (req: Request): string => {
    const value = req.header("x-external-user-id")?.trim();
    if (!value) throw new Error("x-external-user-id is required");
    return value;
  };

  const attachmentFilename = (req: Request): string => {
    const value = req.header("x-file-name") ?? "attachment";
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };

  router.post("/:connectorId/conversations/:conversationId/attachments", rawAttachment, async (req: Request, res: Response) => {
    try {
      if (!options.attachments) throw new Error("Action connector attachments are unavailable");
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new Error("Attachment payload is empty");
      const attachment = await options.attachments.upload({
        connectorId: req.params.connectorId,
        externalUserId: externalUserId(req),
        conversationId: req.params.conversationId,
        filename: attachmentFilename(req),
        mimeType: req.header("content-type") ?? undefined,
        content: req.body
      });
      res.json({ attachment });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.delete("/:connectorId/conversations/:conversationId/attachments/:attachmentId", async (req: Request, res: Response) => {
    try {
      if (!options.attachments) throw new Error("Action connector attachments are unavailable");
      const removed = await options.attachments.remove({
        connectorId: req.params.connectorId,
        externalUserId: externalUserId(req),
        conversationId: req.params.conversationId,
        attachmentId: req.params.attachmentId
      });
      res.status(removed ? 204 : 404).end();
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/:connectorId/conversations/:conversationId/messages", async (req: Request, res: Response) => {
    try {
      if (!options.getConversationMessages) throw new Error("Action connector history is unavailable");
      res.json(await options.getConversationMessages({
        connectorId: req.params.connectorId,
        externalUserId: externalUserId(req),
        conversationId: req.params.conversationId
      }));
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/:connectorId/runs/:runId/cancel", async (req: Request, res: Response) => {
    try {
      if (!options.cancelRun) throw new Error("Action connector cancellation is unavailable");
      res.json({ cancelled: await options.cancelRun({
        connectorId: req.params.connectorId,
        externalUserId: externalUserId(req),
        runId: req.params.runId
      }) });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/:connectorId/conversations/:conversationId/artifacts/:artifactId/content", async (req: Request, res: Response) => {
    try {
      if (!options.sendArtifact) throw new Error("Action connector artifacts are unavailable");
      await options.sendArtifact({
        connectorId: req.params.connectorId,
        externalUserId: externalUserId(req),
        conversationId: req.params.conversationId,
        artifactId: req.params.artifactId,
        disposition: req.query.disposition === "attachment" ? "attachment" : "inline",
        response: res
      });
    } catch (error) {
      if (!res.headersSent) res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/provision", async (req: Request, res: Response) => {
    let payload: ProvisionRequest;
    try {
      payload = provisionRequestSchema.parse(req.body ?? {});
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
      return;
    }

    try {
      const { connectorId, config } = await upsertActionConnector(repository, payload, asRecord(req.body).config);
      const validation = await validator.validate(config);
      await repository.recordValidation(connectorId, {
        triggerType: "automatic",
        status: validation.status,
        summary: validation.summary,
        detail: validation.detail,
        triggeredByUserId: null
      });

      if (validation.status !== "success") {
        await repository.updateInstance(connectorId, { status: "error" });
        res.status(502).json({
          detail: validation.summary,
          connectorId,
          slug: payload.slug,
          status: "error",
          validation,
          runtimeStreamPath: runtimeStreamPath(connectorId),
          runtimeStreamUrl: runtimeStreamUrl(payload.runtimeBaseUrl, connectorId)
        });
        return;
      }

      await repository.updateInstance(connectorId, { status: "active" });
      res.json({
        connectorId,
        slug: payload.slug,
        status: "connected",
        validation,
        runtimeStreamPath: runtimeStreamPath(connectorId),
        runtimeStreamUrl: runtimeStreamUrl(payload.runtimeBaseUrl, connectorId)
      });
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  return router;
}
