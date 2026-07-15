import { Router, type Request, type Response } from "express";
import { z } from "zod";

import type { CodexSkillService } from "./codex-skill-service.js";

const createDraftSchema = z.object({
  prompt: z.string().trim().min(1).max(8000),
  thread_id: z.string().trim().optional().nullable(),
  mode_id: z.string().trim().optional().nullable()
});

const createDraftFromThreadPathSchema = z.object({
  thread_id: z.string().trim().min(1),
  path: z.string().trim().min(1).max(2000),
  prompt: z.string().trim().max(8000).optional().nullable(),
  mode_id: z.string().trim().optional().nullable()
});

const updateManagedSkillStatusSchema = z.object({
  status: z.enum(["active", "disabled", "archived"])
});

const shareManagedSkillSchema = z.object({
  activation_prompt: z.string().trim().max(4000).optional().nullable(),
  skill_package_id: z.string().trim().optional().nullable(),
  agent_mode_ids: z.array(z.string().trim().min(1)).optional()
});

const removeManagedSkillSchema = z.object({
  reason: z.string().trim().max(4000).optional().nullable()
});

const reviseDraftSchema = z.object({
  instruction: z.string().trim().min(1).max(8000)
});

const updateSkillMdSchema = z.object({
  content: z.string().min(1).max(120_000)
});

const reviewSchema = z.object({
  action: z.enum(["reject", "changes_requested"]),
  note: z.string().trim().max(4000).optional().nullable()
});

const publishSchema = z.object({
  review_note: z.string().trim().max(4000).optional().nullable(),
  activation_prompt: z.string().trim().max(4000).optional().nullable(),
  skill_package_id: z.string().trim().optional().nullable(),
  agent_mode_ids: z.array(z.string().trim().min(1)).optional()
});

function actorFromRequest(req: Request) {
  const currentUser = req.currentUser;
  if (!currentUser) throw new Error("Unauthorized");
  return {
    id: currentUser.id,
    displayName: currentUser.displayName,
    email: currentUser.email,
    organizationId: req.currentOrganization?.id
  };
}

function sendValidationError(res: Response, error: z.ZodError): void {
  res.status(400).json({ detail: error.issues[0]?.message ?? "Invalid request" });
}

function detailFromError(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

export function createPortalCodexSkillRouter(service: CodexSkillService): Router {
  const router = Router();

  router.get("/skill-drafts", async (req: Request, res: Response) => {
    try {
      res.json({ drafts: await service.listDraftsForPortal(actorFromRequest(req)) });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/codex-managed-skills", async (req: Request, res: Response) => {
    try {
      res.json({ skills: await service.listManagedSkillsForPortal(actorFromRequest(req)) });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/skill-drafts", async (req: Request, res: Response) => {
    const parsed = createDraftSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const draft = await service.createDraft({
        actor: actorFromRequest(req),
        prompt: parsed.data.prompt,
        sourceThreadId: parsed.data.thread_id || undefined,
        modeId: parsed.data.mode_id || undefined
      });
      res.status(201).json({ draft });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/skill-drafts/from-thread-path", async (req: Request, res: Response) => {
    const parsed = createDraftFromThreadPathSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const resolver = req.app.locals.resolveCodexSkillThreadPath as
        | ((input: { req: Request; threadId: string; requestedPath: string }) => Promise<string>)
        | undefined;
      if (!resolver) throw new Error("Skill path resolver is not available");
      const sourceDirectoryPath = await resolver({
        req,
        threadId: parsed.data.thread_id,
        requestedPath: parsed.data.path
      });
      const draft = await service.createDraftFromDirectory({
        actor: actorFromRequest(req),
        sourceDirectoryPath,
        requestedPrompt: parsed.data.prompt || undefined,
        sourceThreadId: parsed.data.thread_id,
        modeId: parsed.data.mode_id || undefined
      });
      res.status(201).json({ draft });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/codex-managed-skills/install-from-thread-path", async (req: Request, res: Response) => {
    const parsed = createDraftFromThreadPathSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const resolver = req.app.locals.resolveCodexSkillThreadPath as
        | ((input: { req: Request; threadId: string; requestedPath: string }) => Promise<string>)
        | undefined;
      if (!resolver) throw new Error("Skill path resolver is not available");
      const sourceDirectoryPath = await resolver({
        req,
        threadId: parsed.data.thread_id,
        requestedPath: parsed.data.path
      });
      const skill = await service.installSkillFromDirectory({
        actor: actorFromRequest(req),
        sourceDirectoryPath,
        sourceRelativePath: parsed.data.path,
        requestedPrompt: parsed.data.prompt || undefined,
        sourceThreadId: parsed.data.thread_id,
        modeId: parsed.data.mode_id || undefined
      });
      res.status(201).json({ skill });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/codex-managed-skills/:id/uninstall", async (req: Request, res: Response) => {
    const parsed = removeManagedSkillSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const skill = await service.uninstallPrivateManagedSkill({
        actor: actorFromRequest(req),
        skillId: req.params.id,
        reason: parsed.data.reason || undefined
      });
      res.json({ skill });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/skill-drafts/:id", async (req: Request, res: Response) => {
    try {
      res.json({ draft: await service.getDraftForPortal({ actor: actorFromRequest(req), draftId: req.params.id }) });
    } catch (error) {
      res.status(404).json({ detail: detailFromError(error) });
    }
  });

  router.post("/skill-drafts/:id/revise", async (req: Request, res: Response) => {
    const parsed = reviseDraftSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const draft = await service.reviseDraft({
        actor: actorFromRequest(req),
        draftId: req.params.id,
        instruction: parsed.data.instruction
      });
      res.json({ draft });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/skill-drafts/:id/new-version", async (req: Request, res: Response) => {
    const parsed = reviseDraftSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const draft = await service.createNewVersionDraft({
        actor: actorFromRequest(req),
        draftId: req.params.id,
        instruction: parsed.data.instruction
      });
      res.status(201).json({ draft });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  return router;
}

export function createAdminCodexSkillRouter(service: CodexSkillService): Router {
  const router = Router();

  router.get("/codex-skill-drafts", async (req: Request, res: Response) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      res.json({ drafts: await service.listDraftsForAdmin({ organizationId: req.currentOrganization?.id, status }) });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/codex-skill-drafts/:id", async (req: Request, res: Response) => {
    try {
      const draft = await service.readDraftSkillMd(req.params.id);
      res.json(draft);
    } catch (error) {
      res.status(404).json({ detail: detailFromError(error) });
    }
  });

  router.put("/codex-skill-drafts/:id/skill-md", async (req: Request, res: Response) => {
    const parsed = updateSkillMdSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const draft = await service.updateDraftSkillMd({
        actor: actorFromRequest(req),
        draftId: req.params.id,
        content: parsed.data.content
      });
      res.json({ draft });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/codex-skill-drafts/:id/review", async (req: Request, res: Response) => {
    const parsed = reviewSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const actor = actorFromRequest(req);
      const draft =
        parsed.data.action === "reject"
          ? await service.rejectDraft({ actor, draftId: req.params.id, reviewNote: parsed.data.note || undefined })
          : await service.requestChanges({ actor, draftId: req.params.id, reviewNote: parsed.data.note || undefined });
      res.json({ draft });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/codex-skill-drafts/:id/publish", async (req: Request, res: Response) => {
    const parsed = publishSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const result = await service.publishDraft({
        actor: actorFromRequest(req),
        draftId: req.params.id,
        reviewNote: parsed.data.review_note || undefined,
        activationPrompt: parsed.data.activation_prompt || undefined,
        skillPackageId: parsed.data.skill_package_id || undefined,
        agentModeIds: parsed.data.agent_mode_ids
      });
      res.json(result);
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/codex-managed-skills", async (req: Request, res: Response) => {
    try {
      res.json({ skills: await service.listManagedSkills({ organizationId: req.currentOrganization?.id }) });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/codex-managed-skills/:id/content", async (req: Request, res: Response) => {
    try {
      res.json(await service.readManagedSkillMdForAdmin({
        skillId: req.params.id,
        organizationId: req.currentOrganization?.id
      }));
    } catch (error) {
      res.status(404).json({ detail: detailFromError(error) });
    }
  });

  router.post("/codex-managed-skills/:id/status", async (req: Request, res: Response) => {
    const parsed = updateManagedSkillStatusSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const skill = await service.setManagedSkillStatus({
        actor: actorFromRequest(req),
        skillId: req.params.id,
        status: parsed.data.status
      });
      res.json({ skill });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/codex-managed-skills/:id/share", async (req: Request, res: Response) => {
    const parsed = shareManagedSkillSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const result = await service.shareManagedSkillToAgentModes({
        actor: actorFromRequest(req),
        skillId: req.params.id,
        activationPrompt: parsed.data.activation_prompt || undefined,
        skillPackageId: parsed.data.skill_package_id || undefined,
        agentModeIds: parsed.data.agent_mode_ids
      });
      res.json(result);
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/codex-managed-skills/:id/remove", async (req: Request, res: Response) => {
    const parsed = removeManagedSkillSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const skill = await service.removeManagedSkillByAdmin({
        actor: actorFromRequest(req),
        skillId: req.params.id,
        reason: parsed.data.reason || undefined
      });
      res.json({ skill });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  return router;
}
