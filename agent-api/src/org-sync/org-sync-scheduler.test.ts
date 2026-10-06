import { afterEach, describe, expect, it, vi } from "vitest";

import { dailySlots, OrgSyncScheduler } from "./org-sync-scheduler.js";

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

  it("runs daily at the configured Beijing wall-clock time without drifting", async () => {
    vi.useFakeTimers();
    // 2026-10-06 09:00 Beijing; today's 08:17 slot already succeeded.
    vi.setSystemTime(new Date("2026-10-06T01:00:00.000Z"));
    const run = vi.fn(async () => ({ jobId: "job-new", status: "succeeded" as const }));
    const jobs = buildJobs([
      { id: "job-today", provider: "dingtalk", scopeType: "full", scopeExternalId: null, status: "succeeded", finishedAt: new Date("2026-10-06T00:20:00.000Z") }
    ]);
    const scheduler = new OrgSyncScheduler({ run }, jobs as never, { enabled: true, intervalMinutes: 24 * 60, dailyAt: "08:17", timezone: "Asia/Shanghai" });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).not.toHaveBeenCalled();

    // Next slot: 2026-10-07 08:17 Beijing = 00:17 UTC, i.e. 23h17m later.
    await vi.advanceTimersByTimeAsync(23 * 3_600_000 + 16 * 60_000);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(24 * 3_600_000);
    expect(run).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("catches up once on startup when the most recent daily slot was missed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T01:00:00.000Z"));
    const run = vi.fn(async () => ({ jobId: "job-new", status: "succeeded" as const }));
    const jobs = buildJobs([
      { id: "job-old", provider: "dingtalk", scopeType: "full", scopeExternalId: null, status: "succeeded", finishedAt: new Date("2026-10-05T07:00:00.000Z") }
    ]);
    const scheduler = new OrgSyncScheduler({ run }, jobs as never, { enabled: true, intervalMinutes: 24 * 60, dailyAt: "08:17", timezone: "Asia/Shanghai" });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it("computes daily slots in the target timezone", () => {
    const at = { hour: 8, minute: 17 };
    expect(dailySlots(Date.parse("2026-10-06T00:00:00Z"), at, "Asia/Shanghai")).toEqual({
      previous: Date.parse("2026-10-05T00:17:00Z"),
      next: Date.parse("2026-10-06T00:17:00Z")
    });
    // DST zones keep the wall-clock time: 08:17 New York before and after the November switch.
    const ny = dailySlots(Date.parse("2026-11-01T13:00:00Z"), at, "America/New_York");
    expect(ny.previous).toBe(Date.parse("2026-10-31T12:17:00Z"));
    expect(ny.next).toBe(Date.parse("2026-11-01T13:17:00Z"));
  });
});
