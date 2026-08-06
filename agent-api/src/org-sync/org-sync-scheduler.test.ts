import { afterEach, describe, expect, it, vi } from "vitest";

import { OrgSyncScheduler } from "./org-sync-scheduler.js";

function buildJobs(rows: Array<Record<string, unknown>>) {
  return {
    db: {
      syncJob: {
        findMany: vi.fn(async () => rows)
      }
    },
    markFailed: vi.fn(async () => undefined)
  };
}

describe("OrgSyncScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs an overdue full sync immediately after process startup", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-06T08:00:00.000Z"));
    const run = vi.fn(async () => ({ jobId: "job-new", status: "succeeded" as const }));
    const jobs = buildJobs([
      {
        id: "job-old",
        provider: "dingtalk",
        scopeType: "full",
        scopeExternalId: null,
        status: "succeeded",
        finishedAt: new Date("2026-08-05T07:59:00.000Z")
      }
    ]);
    const scheduler = new OrgSyncScheduler(
      { run },
      jobs as never,
      { enabled: true, intervalMinutes: 24 * 60 }
    );

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(run).toHaveBeenCalledWith({ scopeType: "full", triggerType: "scheduled" });
    scheduler.stop();
  });

  it("preserves the next run time across restarts instead of resetting the full interval", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-06T08:00:00.000Z"));
    const run = vi.fn(async () => ({ jobId: "job-new", status: "succeeded" as const }));
    const jobs = buildJobs([
      {
        id: "job-recent",
        provider: "dingtalk",
        scopeType: "full",
        scopeExternalId: null,
        status: "succeeded",
        finishedAt: new Date("2026-08-06T07:30:00.000Z")
      }
    ]);
    const scheduler = new OrgSyncScheduler(
      { run },
      jobs as never,
      { enabled: true, intervalMinutes: 60 }
    );

    scheduler.start();
    await vi.advanceTimersByTimeAsync(29 * 60_000 + 59_000);
    expect(run).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledOnce();
    scheduler.stop();
  });
});
