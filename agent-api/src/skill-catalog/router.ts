import { Router, type Request, type Response } from "express";
import { z } from "zod";

import type { SkillCatalogService } from "./service.js";

const localizedContentSchema = z.object({
  displayName: z.string().trim().max(32).optional(),
  summary: z.string().trim().max(160).optional(),
  useCases: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
  usageSteps: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
  examplePrompts: z.array(z.string().trim().min(1).max(500)).max(12).default([]),
  dataScope: z.string().trim().max(500).optional()
});

const draftSchema = z.object({
  baseConfig: z.object({
    defaultLocale: z.string().trim().min(2).max(32),
    iconKey: z.string().trim().min(1).max(64),
    sortOrder: z.number().int().min(0).max(100000),
    shortcutKey: z.string().trim().max(64).optional(),
    status: z.enum(["active", "disabled"])
  }),
  translations: z.record(z.string(), localizedContentSchema)
});

function detail(error: unknown): string {
  return error instanceof Error ? error.message : "Skill 展示配置操作失败";
}

export function createSkillCatalogAdminRouter(service: SkillCatalogService): Router {
  const router = Router();

  router.get("/skill-catalog", async (req: Request, res: Response) => {
    try {
      res.json({ entries: await service.syncAndList({ organizationId: req.currentOrganization?.id }) });
    } catch (error) {
      res.status(500).json({ detail: detail(error) });
    }
  });

  router.get("/skill-catalog/:id", async (req: Request, res: Response) => {
    try {
      const entry = await service.getAdminRecord({ id: req.params.id, organizationId: req.currentOrganization?.id });
      if (!entry) {
        res.status(404).json({ detail: "Skill 展示配置不存在" });
        return;
      }
      res.json({ entry });
    } catch (error) {
      res.status(500).json({ detail: detail(error) });
    }
  });

  router.put("/skill-catalog/:id/draft", async (req: Request, res: Response) => {
    const parsed = draftSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ detail: parsed.error.issues[0]?.message ?? "Skill 草稿格式不正确" });
      return;
    }
    try {
      const entry = await service.saveDraft({
        id: req.params.id,
        organizationId: req.currentOrganization?.id,
        actorUserId: req.currentUser?.id,
        draft: parsed.data
      });
      res.json({ entry });
    } catch (error) {
      res.status(400).json({ detail: detail(error) });
    }
  });

  router.post("/skill-catalog/:id/publish", async (req: Request, res: Response) => {
    try {
      const entry = await service.publish({
        id: req.params.id,
        organizationId: req.currentOrganization?.id
      });
      res.json({ entry });
    } catch (error) {
      res.status(400).json({ detail: detail(error) });
    }
  });

  return router;
}
