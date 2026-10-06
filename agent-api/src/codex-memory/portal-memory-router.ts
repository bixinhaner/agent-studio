import { Router, type Request, type Response } from "express";
import { z } from "zod";

import type { SystemSettingsCodexMemory } from "../system-settings/types.js";
import {
  PORTAL_MEMORY_CATEGORIES,
  PortalMemoryError,
  type PortalMemoryCategory,
  type PortalMemoryItem,
  type PortalMemoryService
} from "./portal-memory-service.js";

const categorySchema = z.enum(PORTAL_MEMORY_CATEGORIES as unknown as [PortalMemoryCategory, ...PortalMemoryCategory[]]);
const createSchema = z.object({
  scope_id: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(500),
  category: categorySchema
});
const updateSchema = z.object({
  text: z.string().trim().min(1).max(500).optional(),
  category: categorySchema.optional()
});

function itemOut(item: PortalMemoryItem) {
  return {
    id: item.id,
    text: item.text,
    category: item.category,
    source: item.source,
    updated_at: item.updatedAt ?? null
  };
}

function sendError(res: Response, error: unknown, fallback: string) {
  if (error instanceof z.ZodError) {
    res.status(400).json({ detail: error.issues[0]?.message ?? fallback, code: "invalid_input" });
    return;
  }
  if (error instanceof PortalMemoryError) {
    res.status(/not_found/.test(error.code) ? 404 : 400).json({ detail: error.message, code: error.code });
    return;
  }
  res.status(500).json({ detail: error instanceof Error ? error.message : fallback });
}

export function createPortalMemoryRouter(input: {
  service: PortalMemoryService;
  resolveActor(req: Request): { userId: string };
  getSettings(): Promise<SystemSettingsCodexMemory>;
}): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    try {
      const actor = input.resolveActor(req);
      const [scopes, settings] = await Promise.all([input.service.list(actor.userId), input.getSettings()]);
      res.setHeader("Cache-Control", "private, no-store");
      res.json({
        enabled: Boolean(settings.enabled && settings.useMemories),
        scopes: scopes.map((scope) => ({
          id: scope.id,
          organization_key: scope.organizationKey,
          agent_segment: scope.agentSegment,
          mode_id: scope.modeId ?? null,
          updated_at: scope.updatedAt ?? null,
          items: scope.items.map(itemOut)
        }))
      });
    } catch (error) {
      sendError(res, error, "Failed to load memories");
    }
  });

  router.post("/", async (req, res) => {
    try {
      const actor = input.resolveActor(req);
      const body = createSchema.parse(req.body ?? {});
      const home = await input.service.resolveHome(actor.userId, body.scope_id);
      const item = await input.service.add(home.codexHome, { text: body.text, category: body.category });
      res.status(201).json({ scope_id: home.id, item: itemOut(item) });
    } catch (error) {
      sendError(res, error, "Failed to add memory");
    }
  });

  router.patch("/:scopeId/:itemId", async (req, res) => {
    try {
      const actor = input.resolveActor(req);
      const body = updateSchema.parse(req.body ?? {});
      const home = await input.service.resolveHome(actor.userId, String(req.params.scopeId));
      const item = await input.service.update(home.codexHome, String(req.params.itemId), body);
      res.json({ item: itemOut(item) });
    } catch (error) {
      sendError(res, error, "Failed to update memory");
    }
  });

  router.delete("/:scopeId/:itemId", async (req, res) => {
    try {
      const actor = input.resolveActor(req);
      const home = await input.service.resolveHome(actor.userId, String(req.params.scopeId));
      await input.service.remove(home.codexHome, String(req.params.itemId));
      res.json({ ok: true });
    } catch (error) {
      sendError(res, error, "Failed to delete memory");
    }
  });

  return router;
}
