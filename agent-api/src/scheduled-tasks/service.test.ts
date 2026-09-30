import { describe, expect, it, vi } from "vitest";

import { ScheduledTaskService } from "./service.js";

type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key];
    if (condition && typeof condition === "object" && !(condition instanceof Date)) {
      if ("lte" in condition && !(value && value <= condition.lte)) return false;
      if ("lt" in condition && !(value && value < condition.lt)) return false;
      if ("in" in condition && !condition.in.includes(value)) return false;
      if ("notIn" in condition && condition.notIn.includes(value)) return false;
      return true;
    }
    if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime();
    return value === condition;
  });
}

function table(prefix: string) {
  const rows: Row[] = [];
  let seq = 0;
  return {
    rows,
    findMany: vi.fn(async ({ where, orderBy, take, skip }: Row = {}) => {
      let result = rows.filter((row) => matches(row, where));
      if (orderBy) {
        const [[key, dir]] = Object.entries(orderBy) as [[string, string]];
        result = [...result].sort((a, b) => (a[key] > b[key] ? 1 : -1) * (dir === "desc" ? -1 : 1));
      }
      if (skip) result = result.slice(skip);
      if (take) result = result.slice(0, take);
      return result;
    }),
    findFirst: vi.fn(async ({ where }: Row) => rows.find((row) => matches(row, where)) ?? null),
    count: vi.fn(async ({ where }: Row) => rows.filter((row) => matches(row, where)).length),
    create: vi.fn(async ({ data }: Row) => {
      const row = { id: `${prefix}${++seq}`, createdAt: new Date(), updatedAt: new Date(), consecutiveFailures: 0, ...data };
      rows.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: Row) => {
      const row = rows.find((item) => item.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: Row) => {
      const hits = rows.filter((row) => matches(row, where));
      hits.forEach((row) => Object.assign(row, data));
      return { count: hits.length };
    }),
    deleteMany: vi.fn(async ({ where }: Row) => {
      const before = rows.length;
      for (let index = rows.length - 1; index >= 0; index -= 1) if (matches(rows[index], where)) rows.splice(index, 1);
      return { count: before - rows.length };
    })
  };
}

function setup(result: { status: "succeeded" | "failed"; error?: string } = { status: "succeeded" }) {
  const db = { scheduledTask: table("task"), scheduledTaskRun: table("run") };
  let now = new Date("2026-10-01T00:00:00Z");
  const executeTurn = vi.fn(async () => ({ ...result, threadId: "thread-1", answerText: "日报已生成", artifactCount: 1 }));
  const push = { push: vi.fn(async () => "sent" as const) };
  const service = new ScheduledTaskService({
    db: db as never,
    executeTurn,
    push: push as never,
    appBaseUrl: "https://example.test",
    now: () => now
  });
  return { db, service, executeTurn, push, setNow: (value: string) => (now = new Date(value)) };
}

const actor = { userId: "u1", organizationId: "o1" };

describe("ScheduledTaskService", () => {
  it("computes the next run on create and runs due tasks once", async () => {
    const { db, service, executeTurn, push, setNow } = setup();
    const task = await service.create(actor, {
      title: "日报",
      prompt: "总结今天的告警",
      frequency: "daily",
      timeOfDay: "09:00",
      timezone: "Asia/Shanghai"
    });
    expect(task.nextRunAt?.toISOString()).toBe("2026-10-01T01:00:00.000Z");

    await service.tick();
    expect(executeTurn).not.toHaveBeenCalled();

    setNow("2026-10-01T01:00:30Z");
    await Promise.all([service.tick(), service.tick()]);
    await service.waitForIdle();
    expect(executeTurn).toHaveBeenCalledTimes(1);
    expect(db.scheduledTask.rows[0].nextRunAt.toISOString()).toBe("2026-10-02T01:00:00.000Z");
    expect(db.scheduledTaskRun.rows[0]).toMatchObject({ status: "succeeded", threadId: "thread-1", artifactCount: 1, notifyStatus: "sent" });
    expect(push.push).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: "scheduled_task_run",
        link: { url: "https://example.test/?view=workspace&thread=thread-1", label: "查看对话" }
      })
    );
  });

  it("notifies failures even when notifications are off and auto-pauses after repeated failures", async () => {
    const { db, service, push } = setup({ status: "failed", error: "quota exceeded" });
    const task = await service.create(actor, {
      title: "周报",
      prompt: "生成周报",
      frequency: "weekly",
      weekdays: [1],
      timeOfDay: "18:00",
      notifyDingtalk: false
    });
    for (let index = 0; index < 5; index += 1) {
      await service.runNow(actor, task.id);
      await service.waitForIdle();
    }
    expect(push.push).toHaveBeenCalledTimes(5);
    expect(db.scheduledTask.rows[0]).toMatchObject({ enabled: false, nextRunAt: null, consecutiveFailures: 5 });
  });

  it("rejects invalid weekly schedules and scopes access to the owner", async () => {
    const { service } = setup();
    await expect(
      service.create(actor, { title: "x", prompt: "y", frequency: "weekly", weekdays: [], timeOfDay: "09:00" })
    ).rejects.toThrow(/weekday/i);
    const task = await service.create(actor, { title: "x", prompt: "y", frequency: "daily", timeOfDay: "09:00" });
    expect(await service.get({ userId: "u2", organizationId: "o1" }, task.id)).toBeUndefined();
    expect(await service.remove({ userId: "u2", organizationId: "o1" }, task.id)).toBe(false);
    expect(await service.remove(actor, task.id)).toBe(true);
  });
});
