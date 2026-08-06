import { SyncJobRepository } from "../persistence/sync-job-repository.js";
import type { OrgSyncService, OrgSyncRunInput } from "./org-sync-service.js";

type SchedulerTimer = ReturnType<typeof setInterval>;

type OrgSyncSchedulerOptions = {
  enabled: boolean;
  intervalMinutes: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  nowFn?: () => number;
};

const RUNNING_JOB_STATUSES = new Set(["running"]);
const STALE_PENDING_JOB_SUMMARY = {
  detail: "Recovered stale pending org sync job before scheduler tick"
};
const STALE_RUNNING_JOB_SUMMARY = {
  detail: "Recovered stale running org sync job before scheduler tick"
};
const STALE_RUNNING_JOB_AGE_MS = 15 * 60 * 1000;

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

type SchedulerDb = {
  syncJob: {
    findMany(args?: {
      where?: Record<string, unknown>;
      orderBy?: { createdAt?: "asc" | "desc" };
      take?: number;
    }): Promise<Array<Record<string, unknown>>>;
  };
};

function getDb(repository: { [key: string]: unknown }): SchedulerDb {
  const db = (repository as { db?: SchedulerDb }).db;
  if (!db) {
    throw new Error("repository db is unavailable");
  }
  return db;
}

function isOverlapError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already running/i.test(message);
}

function toTimestamp(value: unknown): number | null {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
  }
  return null;
}

function isStaleRunningJob(job: Record<string, unknown>, now = Date.now()): boolean {
  if (String(job.status ?? "") !== "running") {
    return false;
  }
  const startedAt = toTimestamp(job.startedAt) ?? toTimestamp(job.updatedAt) ?? toTimestamp(job.createdAt);
  return startedAt !== null && now - startedAt >= STALE_RUNNING_JOB_AGE_MS;
}

export class OrgSyncScheduler {
  private initialTimer: SchedulerTimer | null = null;
  private intervalTimer: SchedulerTimer | null = null;
  private started = false;
  private inFlight = false;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;
  private readonly nowFn: () => number;

  constructor(
    private readonly service: Pick<OrgSyncService, "run">,
    private readonly jobs: SyncJobRepository,
    private readonly options: OrgSyncSchedulerOptions
  ) {
    this.setIntervalFn = options.setIntervalFn ?? setInterval;
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
    this.nowFn = options.nowFn ?? Date.now;
  }

  start(): void {
    if (!this.options.enabled || this.started) {
      return;
    }

    this.started = true;
    void this.scheduleFromLastSuccessfulRun().catch(() => {
      if (this.started) this.startInterval();
    });
  }

  stop(): void {
    this.started = false;
    if (this.initialTimer) {
      this.clearTimeoutFn(this.initialTimer);
      this.initialTimer = null;
    }
    if (this.intervalTimer) {
      this.clearIntervalFn(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  private get intervalMs(): number {
    return Math.max(1, Math.trunc(this.options.intervalMinutes)) * 60_000;
  }

  private async scheduleFromLastSuccessfulRun(): Promise<void> {
    await this.recoverStaleJobs();
    if (!this.started) return;

    const db = getDb(this.jobs as unknown as { db: SchedulerDb });
    const [lastSuccessfulJob] = await db.syncJob.findMany({
      where: {
        provider: "dingtalk",
        scopeType: "full",
        status: "succeeded"
      },
      orderBy: { createdAt: "desc" },
      take: 1
    });
    const lastSuccessfulAt = lastSuccessfulJob
      ? toTimestamp(lastSuccessfulJob.finishedAt) ??
        toTimestamp(lastSuccessfulJob.updatedAt) ??
        toTimestamp(lastSuccessfulJob.createdAt)
      : null;
    const delayMs = lastSuccessfulAt === null
      ? 0
      : Math.max(0, lastSuccessfulAt + this.intervalMs - this.nowFn());

    if (delayMs === 0) {
      await this.tick().catch(() => undefined);
      if (this.started) this.startInterval();
      return;
    }

    this.initialTimer = this.setTimeoutFn(() => {
      this.initialTimer = null;
      void this.tick()
        .catch(() => undefined)
        .finally(() => {
          if (this.started) this.startInterval();
        });
    }, delayMs);
    this.initialTimer?.unref?.();
  }

  private startInterval(): void {
    if (!this.started || this.intervalTimer) return;
    this.intervalTimer = this.setIntervalFn(() => {
      void this.tick().catch(() => undefined);
    }, this.intervalMs);
    this.intervalTimer?.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.inFlight) {
      return;
    }
    if (await this.hasRunningFullSync()) {
      return;
    }

    this.inFlight = true;
    try {
      const input: OrgSyncRunInput = {
        scopeType: "full",
        triggerType: "scheduled"
      };
      await this.service.run(input);
    } catch (error) {
      if (!isOverlapError(error)) {
        throw error;
      }
    } finally {
      this.inFlight = false;
    }
  }

  private async hasRunningFullSync(): Promise<boolean> {
    await this.recoverStaleJobs();
    const db = getDb(this.jobs as unknown as { db: { syncJob: { findMany(args?: { where?: Record<string, unknown> }): Promise<Array<Record<string, unknown>>> } } });
    const currentJobs = await db.syncJob.findMany();
    return currentJobs.some((job) => {
      const scopeType = String(job.scopeType ?? "");
      const status = String(job.status ?? "");
      const scopeExternalId = trimOrUndefined(job.scopeExternalId as string | null);
      return scopeType === "full" && scopeExternalId === undefined && RUNNING_JOB_STATUSES.has(status);
    });
  }

  private async recoverStaleJobs(): Promise<void> {
    const db = getDb(this.jobs as unknown as { db: { syncJob: { findMany(args?: { where?: Record<string, unknown> }): Promise<Array<Record<string, unknown>>> } } });
    const jobs = await db.syncJob.findMany();
    for (const job of jobs) {
      if (String(job.provider ?? "dingtalk") !== "dingtalk") continue;
      const jobId = trimOrUndefined(job.id as string | null);
      if (!jobId) continue;
      if (String(job.status ?? "") === "pending") {
        await this.jobs.markFailed(jobId, STALE_PENDING_JOB_SUMMARY);
        continue;
      }
      if (isStaleRunningJob(job)) {
        await this.jobs.markFailed(jobId, STALE_RUNNING_JOB_SUMMARY);
      }
    }
  }
}
