import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { SecurityDomainConflictError, type SecurityDomainService } from "./service.js";

const ruleSchema = z.object({
  subject_type: z.enum(["user", "department"]),
  subject_id: z.string().trim().min(1),
  include_children: z.boolean().optional().default(false)
});

const domainSchema = z.object({
  name: z.string().trim().min(1).max(100),
  status: z.enum(["active", "inactive"]).optional().default("active"),
  rules: z.array(ruleSchema).max(500).optional().default([])
});

function organizationId(req: Request): string {
  const id = req.currentOrganization?.id?.trim();
  if (!id) throw new Error("当前组织不存在");
  return id;
}

function errorResponse(error: unknown): { status: number; body: Record<string, unknown> } {
  if (error instanceof SecurityDomainConflictError) {
    const preview = error.conflicts
      .slice(0, 5)
      .map((conflict) => `${conflict.userId}（${conflict.domainNames.join("、")}）`)
      .join("；");
    const suffix = error.conflicts.length > 5 ? `等 ${error.conflicts.length} 人` : "";
    return {
      status: 409,
      body: {
        detail: `${error.message}：${preview}${suffix}`,
        conflicts: error.conflicts
      }
    };
  }
  if (error instanceof z.ZodError) {
    return { status: 400, body: { detail: error.issues[0]?.message ?? "请求参数不合法" } };
  }
  const detail = error instanceof Error ? error.message : "保密域操作失败";
  return { status: detail.includes("不存在") ? 404 : 400, body: { detail } };
}

function inputRules(rules: z.infer<typeof ruleSchema>[]) {
  return rules.map((rule) => ({
    subjectType: rule.subject_type,
    subjectId: rule.subject_id,
    includeChildren: rule.include_children
  }));
}

export function createSecurityDomainAdminRouter(service: SecurityDomainService): Router {
  const router = Router();

  router.get("/", async (req: Request, res: Response) => {
    try {
      res.json({ domains: await service.list(organizationId(req)) });
    } catch (error) {
      const response = errorResponse(error);
      res.status(response.status).json(response.body);
    }
  });

  router.post("/", async (req: Request, res: Response) => {
    try {
      const input = domainSchema.parse(req.body ?? {});
      const domain = await service.create({
        organizationId: organizationId(req),
        name: input.name,
        status: input.status,
        rules: inputRules(input.rules)
      });
      res.status(201).json({ domain });
    } catch (error) {
      const response = errorResponse(error);
      res.status(response.status).json(response.body);
    }
  });

  router.put("/:domainId", async (req: Request, res: Response) => {
    try {
      const input = domainSchema.parse(req.body ?? {});
      const domain = await service.update({
        organizationId: organizationId(req),
        domainId: String(req.params.domainId ?? "").trim(),
        name: input.name,
        status: input.status,
        rules: inputRules(input.rules)
      });
      res.json({ domain });
    } catch (error) {
      const response = errorResponse(error);
      res.status(response.status).json(response.body);
    }
  });

  router.post("/refresh", async (req: Request, res: Response) => {
    try {
      await service.refresh(organizationId(req));
      res.json({ ok: true });
    } catch (error) {
      const response = errorResponse(error);
      res.status(response.status).json(response.body);
    }
  });

  return router;
}
