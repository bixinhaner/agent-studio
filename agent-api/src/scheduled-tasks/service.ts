import type { Prisma, PrismaClient, ScheduledTask, ScheduledTaskRun } from "@prisma/client";

import type { DingTalkPushService } from "../notifications/dingtalk-push-service.js";
import type { ScheduledTurnInput, ScheduledTurnResult } from "./loopback-executor.js";
import {
  computeNextRunAt,
  isValidTimeOfDay,
  isValidTimezone,
  SCHEDULE_FREQUENCIES,
  type ScheduleFrequency
} from "./schedule.js";

export const MAX_TASKS_PER_USER = 20;
const MAX_RUNS_KEPT_PER_TASK = 50;
const RUN_LEASE_MS = 60 * 60_000;
const AUTO_PAUSE_AFTER_FAILURES = 5;

export class ScheduledTaskValidationError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

export type ScheduledTaskInput = {
  title: string;
  prompt: string;
  frequency: ScheduleFrequency;
  weekdays?: number[];
  dayOfMonth?: number | null;
  timeOfDay: string;
  timezone?: string;
  locale?: "en" | "zh-CN";
  modeId?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
  runConfig?: Record<string, unknown>;
  skillIds?: string[];
  folderId?: string | null;
  sourceThreadId?: string | null;
  notifyDingtalk?: boolean;
  enabled?: boolean;
};

export type ScheduledTaskActor = { userId: string; organizationId: string };

type TaskDb = Pick<PrismaClient, "scheduledTask" | "scheduledTaskRun">;

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => Number.isInteger(item)) : [];
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function scheduledTaskOut(task: ScheduledTask, runs?: ScheduledTaskRun[]) {
  return {
    id: task.id,
    title: task.title,
    prompt: task.prompt,
    frequency: task.frequency,
    weekdays: numberArray(task.weekdays),
    day_of_month: task.dayOfMonth,
    time_of_day: task.timeOfDay,
    timezone: task.timezone,
    locale: task.locale,
    mode_id: task.modeId,
    model: task.model,
    reasoning_effort: task.reasoningEffort,
    skill_ids: stringArray(task.skillIds),
    folder_id: task.folderId,
    source_thread_id: task.sourceThreadId,
    enabled: task.enabled,
    notify_dingtalk: task.notifyDingtalk,
    next_run_at: task.nextRunAt?.toISOString() ?? null,
    last_run_at: task.lastRunAt?.toISOString() ?? null,
    last_run_status: task.lastRunStatus,
    last_thread_id: task.lastThreadId,
    consecutive_failures: task.consecutiveFailures,
    created_at: task.createdAt.toISOString(),
    updated_at: task.updatedAt.toISOString(),
    ...(runs ? { runs: runs.map(scheduledTaskRunOut) } : {})
  };
}

export function scheduledTaskRunOut(run: ScheduledTaskRun) {
  return {
    id: run.id,
    task_id: run.taskId,
    trigger: run.trigger,
    status: run.status,
    thread_id: run.threadId,
    scheduled_for: run.scheduledFor?.toISOString() ?? null,
    started_at: run.startedAt.toISOString(),
    finished_at: run.finishedAt?.toISOString() ?? null,
    answer_preview: run.answerPreview,
    artifact_count: run.artifactCount,
    error: run.error,
    notify_status: run.notifyStatus
  };
}

export function normalizeScheduledTaskInput(input: ScheduledTaskInput) {
  const title = input.title.trim();
  const prompt = input.prompt.trim();
  if (!title) throw new ScheduledTaskValidationError("Task title is required", "title_required");
  if (!prompt) throw new ScheduledTaskValidationError("Task prompt is required", "prompt_required");
  if (!SCHEDULE_FREQUENCIES.includes(input.frequency)) {
    throw new ScheduledTaskValidationError("Unsupported frequency", "invalid_frequency");
  }
  if (!isValidTimeOfDay(input.timeOfDay)) {
    throw new ScheduledTaskValidationError("Time must use HH:MM", "invalid_time");
  }
  const timezone = input.timezone?.trim() || "Asia/Shanghai";
  if (!isValidTimezone(timezone)) throw new ScheduledTaskValidationError("Unknown timezone", "invalid_timezone");
  const weekdays = [...new Set((input.weekdays ?? []).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort();
  if (input.frequency === "weekly" && !weekdays.length) {
    throw new ScheduledTaskValidationError("Pick at least one weekday", "weekdays_required");
  }
  const dayOfMonth = input.frequency === "monthly" ? Math.min(Math.max(Math.trunc(input.dayOfMonth ?? 1), 1), 31) : null;
  return {
    title: truncate(title, 120),
    prompt: truncate(prompt, 8000),
    frequency: input.frequency as string,
    weekdays,
    dayOfMonth,
    timeOfDay: input.timeOfDay,
    timezone,
    locale: (input.locale === "en" ? "en" : "zh-CN") as string,
    modeId: input.modeId?.trim() || null,
    model: input.model?.trim() || null,
    reasoningEffort: input.reasoningEffort?.trim() || null,
    runConfig: input.runConfig ?? {},
    skillIds: [...new Set((input.skillIds ?? []).map((id) => id.trim()).filter(Boolean))].slice(0, 20),
    folderId: input.folderId?.trim() || null,
    sourceThreadId: input.sourceThreadId?.trim() || null,
    notifyDingtalk: input.notifyDingtalk !== false,
    enabled: input.enabled !== false
  };
}

type ScheduleFields = {
  frequency: string;
  weekdays: unknown;
  dayOfMonth: number | null;
  timeOfDay: string;
  timezone: string;
};

function nextRunFor(task: ScheduleFields, after: Date): Date {
  return computeNextRunAt(
    {
      frequency: task.frequency as ScheduleFrequency,
      weekdays: numberArray(task.weekdays),
      dayOfMonth: task.dayOfMonth,
      timeOfDay: task.timeOfDay,
      timezone: task.timezone
    },
    after
  );
}

type ServiceOptions = {
  db: TaskDb;
  executeTurn(input: ScheduledTurnInput): Promise<ScheduledTurnResult>;
  push?: Pick<DingTalkPushService, "push">;
  appBaseUrl?: string;
  /** Returns a reason when new runtime turns must not start (deploy drain). */
  getDrainReason?(): Promise<string | undefined> | string | undefined;
  now?(): Date;
  logger?: Pick<Console, "info" | "warn">;
  maxConcurrentRuns?: number;
};

export class ScheduledTaskService {
  private readonly running = new Map<string, { userId: string; promise: Promise<void> }>();
  /** taskId → runId for runs owned by this process (excluded from stale recovery). */
  private readonly runIds = new Map<string, string>();
  private timer: NodeJS.Timeout | undefined;
  private ticking = false;

  constructor(private readonly options: ServiceOptions) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  async list(actor: ScheduledTaskActor) {
    const tasks = await this.options.db.scheduledTask.findMany({
      where: { userId: actor.userId, organizationId: actor.organizationId },
      orderBy: { createdAt: "desc" }
    });
    return tasks;
  }

  async get(actor: ScheduledTaskActor, taskId: string) {
    const task = await this.options.db.scheduledTask.findFirst({
      where: { id: taskId, userId: actor.userId, organizationId: actor.organizationId }
    });
    if (!task) return undefined;
    const runs = await this.options.db.scheduledTaskRun.findMany({
      where: { taskId: task.id },
      orderBy: { startedAt: "desc" },
      take: 20
    });
    return { task, runs };
  }

  async create(actor: ScheduledTaskActor, input: ScheduledTaskInput) {
    const normalized = normalizeScheduledTaskInput(input);
    const count = await this.options.db.scheduledTask.count({ where: { userId: actor.userId } });
    if (count >= MAX_TASKS_PER_USER) {
      throw new ScheduledTaskValidationError(`At most ${MAX_TASKS_PER_USER} scheduled tasks are allowed`, "too_many_tasks");
    }
    const nextRunAt = normalized.enabled ? nextRunFor(normalized, this.now()) : null;
    return this.options.db.scheduledTask.create({
      data: {
        organizationId: actor.organizationId,
        userId: actor.userId,
        ...normalized,
        weekdays: normalized.weekdays,
        skillIds: normalized.skillIds,
        runConfig: normalized.runConfig as Prisma.InputJsonValue,
        nextRunAt
      }
    });
  }

  async update(actor: ScheduledTaskActor, taskId: string, patch: Partial<ScheduledTaskInput>) {
    const existing = await this.options.db.scheduledTask.findFirst({
      where: { id: taskId, userId: actor.userId, organizationId: actor.organizationId }
    });
    if (!existing) return undefined;
    const normalized = normalizeScheduledTaskInput({
      title: patch.title ?? existing.title,
      prompt: patch.prompt ?? existing.prompt,
      frequency: (patch.frequency ?? existing.frequency) as ScheduleFrequency,
      weekdays: patch.weekdays ?? numberArray(existing.weekdays),
      dayOfMonth: patch.dayOfMonth !== undefined ? patch.dayOfMonth : existing.dayOfMonth,
      timeOfDay: patch.timeOfDay ?? existing.timeOfDay,
      timezone: patch.timezone ?? existing.timezone,
      locale: patch.locale ?? (existing.locale === "en" ? "en" : "zh-CN"),
      modeId: patch.modeId !== undefined ? patch.modeId : existing.modeId,
      model: patch.model !== undefined ? patch.model : existing.model,
      reasoningEffort: patch.reasoningEffort !== undefined ? patch.reasoningEffort : existing.reasoningEffort,
      runConfig: patch.runConfig ?? ((existing.runConfig ?? {}) as Record<string, unknown>),
      skillIds: patch.skillIds ?? stringArray(existing.skillIds),
      folderId: patch.folderId !== undefined ? patch.folderId : existing.folderId,
      sourceThreadId: existing.sourceThreadId,
      notifyDingtalk: patch.notifyDingtalk ?? existing.notifyDingtalk,
      enabled: patch.enabled ?? existing.enabled
    });
    const nextRunAt = normalized.enabled ? nextRunFor(normalized, this.now()) : null;
    return this.options.db.scheduledTask.update({
      where: { id: existing.id },
      data: {
        ...normalized,
        weekdays: normalized.weekdays,
        skillIds: normalized.skillIds,
        runConfig: normalized.runConfig as Prisma.InputJsonValue,
        nextRunAt,
        ...(normalized.enabled && !existing.enabled ? { consecutiveFailures: 0 } : {})
      }
    });
  }

  async remove(actor: ScheduledTaskActor, taskId: string): Promise<boolean> {
    const result = await this.options.db.scheduledTask.deleteMany({
      where: { id: taskId, userId: actor.userId, organizationId: actor.organizationId }
    });
    return result.count > 0;
  }

  isUserRunning(userId: string): boolean {
    return [...this.running.values()].some((item) => item.userId === userId);
  }

  /** Starts a manual run immediately; returns the run record. */
  async runNow(actor: ScheduledTaskActor, taskId: string) {
    const task = await this.options.db.scheduledTask.findFirst({
      where: { id: taskId, userId: actor.userId, organizationId: actor.organizationId }
    });
    if (!task) return undefined;
    const drain = await this.options.getDrainReason?.();
    if (drain) throw new ScheduledTaskValidationError(drain, "deployment_draining");
    if (this.running.has(task.id)) {
      throw new ScheduledTaskValidationError("This task is already running", "already_running");
    }
    return this.startRun(task, "manual", this.now());
  }

  start(intervalMs = 30_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
    void this.recoverStaleRuns();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async waitForIdle(): Promise<void> {
    await Promise.all([...this.running.values()].map((item) => item.promise));
  }

  /** Marks runs whose worker died (restart/deploy) as failed. */
  async recoverStaleRuns(): Promise<number> {
    const now = this.now();
    const result = await this.options.db.scheduledTaskRun.updateMany({
      where: {
        status: "running",
        leaseExpiresAt: { lt: now },
        id: { notIn: [...this.runIds.values()] }
      },
      data: { status: "failed", finishedAt: now, error: "Interrupted by a service restart" }
    });
    return result.count;
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      if (await this.options.getDrainReason?.()) return;
      const capacity = (this.options.maxConcurrentRuns ?? 2) - this.running.size;
      if (capacity <= 0) return;
      const now = this.now();
      const due = await this.options.db.scheduledTask.findMany({
        where: { enabled: true, nextRunAt: { lte: now } },
        orderBy: { nextRunAt: "asc" },
        take: capacity * 3
      });
      let started = 0;
      for (const task of due) {
        if (started >= capacity) break;
        if (this.running.has(task.id) || this.isUserRunning(task.userId)) continue;
        const scheduledFor = task.nextRunAt ?? now;
        // Advance next_run_at atomically so only one worker claims this slot,
        // and missed slots during downtime collapse into a single run.
        const claimed = await this.options.db.scheduledTask.updateMany({
          where: { id: task.id, enabled: true, nextRunAt: task.nextRunAt },
          data: { nextRunAt: nextRunFor(task, now) }
        });
        if (claimed.count !== 1) continue;
        await this.startRun(task, "schedule", scheduledFor);
        started += 1;
      }
      await this.recoverStaleRuns();
    } catch (error) {
      this.options.logger?.warn("scheduled task tick failed", error instanceof Error ? error.message : String(error));
    } finally {
      this.ticking = false;
    }
  }

  private async startRun(task: ScheduledTask, trigger: "schedule" | "manual", scheduledFor: Date) {
    const now = this.now();
    const run = await this.options.db.scheduledTaskRun.create({
      data: {
        taskId: task.id,
        userId: task.userId,
        trigger,
        status: "running",
        scheduledFor,
        startedAt: now,
        leaseExpiresAt: new Date(now.getTime() + RUN_LEASE_MS)
      }
    });
    this.runIds.set(task.id, run.id);
    const promise = this.executeRun(task, run).finally(() => {
      this.running.delete(task.id);
      this.runIds.delete(task.id);
    });
    this.running.set(task.id, { userId: task.userId, promise });
    return run;
  }

  private titleFor(task: ScheduledTask, at: Date): string {
    const date = new Intl.DateTimeFormat(task.locale === "en" ? "en-US" : "zh-CN", {
      timeZone: task.timezone,
      month: "2-digit",
      day: "2-digit"
    }).format(at);
    return truncate(`${task.title} · ${date}`, 120);
  }

  private async executeRun(task: ScheduledTask, run: ScheduledTaskRun): Promise<void> {
    let result: ScheduledTurnResult;
    try {
      result = await this.options.executeTurn({
        userId: task.userId,
        organizationId: task.organizationId,
        title: this.titleFor(task, run.startedAt),
        prompt: task.prompt,
        folderId: task.folderId,
        modeId: task.modeId,
        model: task.model,
        reasoningEffort: task.reasoningEffort,
        runConfig: (task.runConfig ?? {}) as Record<string, unknown>,
        skillIds: stringArray(task.skillIds),
        locale: task.locale === "en" ? "en" : "zh-CN"
      });
    } catch (error) {
      result = { status: "failed", artifactCount: 0, error: error instanceof Error ? error.message : String(error) };
    }
    const finishedAt = this.now();
    const failed = result.status !== "succeeded";
    await this.options.db.scheduledTaskRun.update({
      where: { id: run.id },
      data: {
        status: result.status,
        threadId: result.threadId,
        finishedAt,
        answerPreview: result.answerText ? truncate(result.answerText, 600) : null,
        artifactCount: result.artifactCount,
        error: result.error ? truncate(result.error, 1000) : null,
        leaseExpiresAt: null
      }
    });
    const consecutiveFailures = failed ? task.consecutiveFailures + 1 : 0;
    const autoPause = failed && consecutiveFailures >= AUTO_PAUSE_AFTER_FAILURES;
    await this.options.db.scheduledTask
      .update({
        where: { id: task.id },
        data: {
          lastRunAt: run.startedAt,
          lastRunStatus: result.status,
          lastThreadId: result.threadId ?? task.lastThreadId,
          consecutiveFailures,
          ...(autoPause ? { enabled: false, nextRunAt: null } : {})
        }
      })
      .catch(() => undefined); // The task may have been deleted mid-run.
    await this.pruneRuns(task.id);

    // Failures always notify so broken schedules never fail silently.
    if (this.options.push && (task.notifyDingtalk || failed)) {
      const notifyStatus = await this.options.push
        .push(this.buildNotification(task, run, result, autoPause))
        .catch(() => "failed" as const);
      await this.options.db.scheduledTaskRun
        .update({ where: { id: run.id }, data: { notifyStatus } })
        .catch(() => undefined);
    }
    this.options.logger?.info("scheduled task run finished", {
      taskId: task.id,
      runId: run.id,
      status: result.status,
      threadId: result.threadId
    });
  }

  private buildNotification(task: ScheduledTask, run: ScheduledTaskRun, result: ScheduledTurnResult, autoPaused: boolean) {
    const en = task.locale === "en";
    const failed = result.status !== "succeeded";
    const heading = failed
      ? en ? `Scheduled task failed: ${task.title}` : `定时任务失败：${task.title}`
      : en ? `Scheduled task finished: ${task.title}` : `定时任务已完成：${task.title}`;
    const lines = [`### ${heading}`];
    if (failed) {
      lines.push(en ? `**Reason:** ${truncate(result.error ?? "Unknown error", 300)}` : `**原因：** ${truncate(result.error ?? "未知错误", 300)}`);
      if (autoPaused) {
        lines.push(en ? "The task was paused after repeated failures." : "连续多次失败，任务已自动暂停。");
      }
    } else {
      if (result.answerText) lines.push(truncate(result.answerText.replace(/\n{3,}/g, "\n\n"), 500));
      if (result.artifactCount > 0) {
        lines.push(en ? `**Files generated:** ${result.artifactCount}` : `**生成文件：** ${result.artifactCount} 个`);
      }
    }
    const baseUrl = this.options.appBaseUrl?.replace(/\/+$/, "");
    const link = baseUrl && result.threadId
      ? { url: `${baseUrl}/?view=workspace&thread=${encodeURIComponent(result.threadId)}`, label: en ? "Open conversation" : "查看对话" }
      : baseUrl
        ? { url: `${baseUrl}/?view=scheduled-tasks`, label: en ? "Open scheduled tasks" : "查看定时任务" }
        : undefined;
    return {
      userId: task.userId,
      sourceType: "scheduled_task_run",
      sourceId: run.id,
      title: heading,
      markdown: lines.join("\n\n"),
      link
    };
  }

  private async pruneRuns(taskId: string): Promise<void> {
    const stale = await this.options.db.scheduledTaskRun.findMany({
      where: { taskId },
      orderBy: { startedAt: "desc" },
      skip: MAX_RUNS_KEPT_PER_TASK,
      select: { id: true }
    });
    if (stale.length) {
      await this.options.db.scheduledTaskRun.deleteMany({ where: { id: { in: stale.map((item) => item.id) } } });
    }
  }
}
