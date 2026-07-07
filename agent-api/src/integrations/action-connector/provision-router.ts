import express, { type Request, type Response } from "express";
import { z } from "zod";

import { IntegrationInstanceRepository, type IntegrationInstanceRepositoryDb } from "../../persistence/integration-instance-repository.js";
import { ActionConnectorIntegrationAdapter, actionConnectorConfigSchema } from "../center/action-connector-adapter.js";

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

async function upsertActionConnector(repository: IntegrationInstanceRepository, payload: ProvisionRequest) {
  const existing = await findActionConnectorBySlug(repository, payload.slug);
  if (existing) {
    await repository.updateInstance(existing.id, {
      name: payload.name,
      description: payload.description ?? null,
      status: payload.status ?? "active"
    });
    await repository.upsertConfig(existing.id, payload.config);
    return existing.id;
  }

  const created = await repository.createInstance({
    type: "action_connector",
    slug: payload.slug,
    name: payload.name,
    description: payload.description ?? null,
    status: payload.status ?? "active"
  });
  await repository.upsertConfig(created.id, payload.config);
  return created.id;
}

export function createActionConnectorProvisionRouter(options: {
  db: IntegrationInstanceRepositoryDb;
  fetchImpl?: typeof fetch;
}) {
  const router = express.Router();
  const repository = new IntegrationInstanceRepository(options.db);
  const validator = new ActionConnectorIntegrationAdapter(options.fetchImpl);

  router.post("/provision", async (req: Request, res: Response) => {
    let payload: ProvisionRequest;
    try {
      payload = provisionRequestSchema.parse(req.body ?? {});
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
      return;
    }

    try {
      const connectorId = await upsertActionConnector(repository, payload);
      const validation = await validator.validate(payload.config);
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
