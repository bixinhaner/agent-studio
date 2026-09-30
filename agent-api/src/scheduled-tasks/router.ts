import { Router, type Request, type Response } from "express";
import { z } from "zod";

import {
  scheduledTaskOut,
  scheduledTaskRunOut,
  ScheduledTaskValidationError,
  type ScheduledTaskActor,
  type ScheduledTaskService
} from "./service.js";

const taskBodySchema = z.object({
  title: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(8000),
  frequency: z.enum(["daily", "weekdays", "weekly", "monthly"]),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  day_of_month: z.number().int().min(1).max(31).nullable().optional(),
  time_of_day: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  timezone: z.string().trim().min(1).max(64).optional(),
  locale: z.enum(["en", "zh-CN"]).optional(),
  mode_id: z.string().trim().min(1).nullable().optional(),
  model: z.string().trim().min(1).nullable().optional(),
  reasoning_effort: z.string().trim().min(1).nullable().optional(),
  run_config: z.record(z.unknown()).optional(),
  skill_ids: z.array(z.string().trim().min(1)).max(20).optional(),
  folder_id: z.string().trim().min(1).nullable().optional(),
  source_thread_id: z.string().trim().min(1).nullable().optional(),
  notify_dingtalk: z.boolean().optional(),
  enabled: z.boolean().optional()
});

type TaskBody = z.infer<typeof taskBodySchema>;

function toInput(body: Partial<TaskBody>) {
  return {
    title: body.title,
    prompt: body.prompt,
    frequency: body.frequency,
    weekdays: body.weekdays,
    dayOfMonth: body.day_of_month,
    timeOfDay: body.time_of_day,
    timezone: body.timezone,
    locale: body.locale,
    modeId: body.mode_id,
    model: body.model,
    reasoningEffort: body.reasoning_effort,
    runConfig: body.run_config,
    skillIds: body.skill_ids,
    folderId: body.folder_id,
    sourceThreadId: body.source_thread_id,
    notifyDingtalk: body.notify_dingtalk,
    enabled: body.enabled
  };
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}

function sendError(res: Response, error: unknown, fallback: string) {
  if (error instanceof z.ZodError) {
    res.status(400).json({ detail: error.issues[0]?.message ?? fallback, code: "invalid_input" });
    return;
  }
  if (error instanceof ScheduledTaskValidationError) {
    res.status(error.code === "already_running" ? 409 : error.code === "deployment_draining" ? 503 : 400).json({
      detail: error.message,
      code: error.code
    });
    return;
  }
  res.status(500).json({ detail: error instanceof Error ? error.message : fallback });
}

export function createScheduledTaskRouter(input: {
  service: ScheduledTaskService;
  resolveActor(req: Request): ScheduledTaskActor;
  isDingTalkAvailable?(userId: string): Promise<boolean>;
}): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    try {
      const actor = input.resolveActor(req);
      const [tasks, dingtalkAvailable] = await Promise.all([
        input.service.list(actor),
        input.isDingTalkAvailable?.(actor.userId) ?? Promise.resolve(false)
      ]);
      res.setHeader("Cache-Control", "private, no-store");
      res.json({ tasks: tasks.map((task) => scheduledTaskOut(task)), dingtalk_available: dingtalkAvailable });
    } catch (error) {
      sendError(res, error, "Failed to list scheduled tasks");
    }
  });

  router.post("/", async (req, res) => {
    try {
      const actor = input.resolveActor(req);
      const body = taskBodySchema.parse(req.body ?? {});
      const task = await input.service.create(actor, toInput(body) as never);
      res.status(201).json({ task: scheduledTaskOut(task) });
    } catch (error) {
      sendError(res, error, "Failed to create scheduled task");
    }
  });

  router.get("/:taskId", async (req, res) => {
    try {
      const found = await input.service.get(input.resolveActor(req), String(req.params.taskId));
      if (!found) {
        res.status(404).json({ detail: "Scheduled task does not exist" });
        return;
      }
      res.setHeader("Cache-Control", "private, no-store");
      res.json({ task: scheduledTaskOut(found.task, found.runs) });
    } catch (error) {
      sendError(res, error, "Failed to load scheduled task");
    }
  });

  router.patch("/:taskId", async (req, res) => {
    try {
      const body = taskBodySchema.partial().parse(req.body ?? {});
      const task = await input.service.update(
        input.resolveActor(req),
        String(req.params.taskId),
        withoutUndefined(toInput(body)) as never
      );
      if (!task) {
        res.status(404).json({ detail: "Scheduled task does not exist" });
        return;
      }
      res.json({ task: scheduledTaskOut(task) });
    } catch (error) {
      sendError(res, error, "Failed to update scheduled task");
    }
  });

  router.delete("/:taskId", async (req, res) => {
    try {
      const removed = await input.service.remove(input.resolveActor(req), String(req.params.taskId));
      if (!removed) {
        res.status(404).json({ detail: "Scheduled task does not exist" });
        return;
      }
      res.json({ ok: true });
    } catch (error) {
      sendError(res, error, "Failed to delete scheduled task");
    }
  });

  router.post("/:taskId/run", async (req, res) => {
    try {
      const run = await input.service.runNow(input.resolveActor(req), String(req.params.taskId));
      if (!run) {
        res.status(404).json({ detail: "Scheduled task does not exist" });
        return;
      }
      res.status(202).json({ run: scheduledTaskRunOut(run) });
    } catch (error) {
      sendError(res, error, "Failed to start scheduled task");
    }
  });

  return router;
}
