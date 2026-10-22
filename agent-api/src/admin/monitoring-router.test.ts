import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createMonitoringRouter } from "./monitoring-router.js";
import type { UsageEventRecord } from "../persistence/usage-event-repository.js";

function usageEvent(overrides: Partial<UsageEventRecord> = {}): UsageEventRecord {
  return {
    id: "usage-1",
    organizationId: "org-1",
    userId: "user-1",
    departmentIdSnapshot: "dept-1",
    threadId: "thread-1",
    sessionId: "session-1",
    model: "gpt-5.6-sol",
    featureType: "chat",
    inputTokens: 100,
    cachedInputTokens: 40,
    cacheWriteTokens: 0,
    outputTokens: 10,
    estimatedCost: "0.100000",
    internalCost: "0.010000",
    resultStatus: "success",
    metadata: { source: "web" },
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

function createApp(overrides: { operationsInsightsCacheTtlMs?: number; batched?: boolean } = {}) {
  const batched = overrides.batched ?? true;
  const deps = {
    listEvents: vi.fn(async () => [usageEvent()]),
    listInsightEvents: vi.fn(async () => [usageEvent()]),
    listSessions: vi.fn(async () => [{ sessionId: "session-1", threadId: "thread-1" }]),
    listInsightRefs: vi.fn(async () => [
      { sessionId: "session-1", threadId: "thread-1", providerSnapshot: { source: "local_auth", kind: "chatgpt" } }
    ]),
    getUser: vi.fn(async (id: string) => ({ id, displayName: "Ada", email: "ada@example.com", role: "member" })),
    listUsers: vi.fn(async (ids: string[]) => ids.map((id) => ({ id, displayName: "Ada", email: "ada@example.com", role: "member" }))),
    getDepartment: vi.fn(async (id: string) => ({ id, name: "Sales" })),
    listDepartments: vi.fn(async (ids: string[]) => ids.map((id) => ({ id, name: "Sales" })))
  };
  const notUsed = vi.fn(async () => {
    throw new Error("not used");
  });
  const router = createMonitoringRouter({
    requirePermission: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    resourceAccessLogs: { list: notUsed },
    usageLedger: {
      buildOverview: vi.fn(),
      buildRankings: vi.fn(),
      buildTrends: vi.fn(),
      listEvents: deps.listEvents,
      ...(batched ? { listInsightEvents: deps.listInsightEvents } : {})
    },
    usageRollups: { list: notUsed },
    sessions: { listByIds: deps.listSessions, ...(batched ? { listInsightRefsByIds: deps.listInsightRefs } : {}) },
    users: { getById: deps.getUser, ...(batched ? { listByIds: deps.listUsers } : {}) },
    organizations: { listByIds: vi.fn(async () => [{ id: "org-1", name: "Baicells" }]) },
    departments: { getById: deps.getDepartment, ...(batched ? { listByIds: deps.listDepartments } : {}) },
    quotaPolicies: { list: notUsed, upsert: notUsed, getById: notUsed, update: notUsed },
    costProfiles: { list: notUsed, listActive: notUsed, upsert: notUsed, getById: notUsed, update: notUsed },
    alertRules: { list: notUsed, create: notUsed, getById: notUsed, update: notUsed },
    alertEvents: { list: notUsed, getById: notUsed, update: notUsed },
    notificationRecords: { list: notUsed },
    quotaSnapshots: { list: vi.fn(async () => []) },
    operationsInsightsCacheTtlMs: overrides.operationsInsightsCacheTtlMs
  } as unknown as Parameters<typeof createMonitoringRouter>[0]);
  const app = express();
  app.use("/api/admin", router);
  return { app, deps };
}

describe("operations insights route", () => {
  it("loads slim events and batches the user and department lookups", async () => {
    const { app, deps } = createApp();
    const response = await request(app).get("/api/admin/monitoring/operations-insights?days=7");

    expect(response.status).toBe(200);
    expect(deps.listInsightEvents).toHaveBeenCalledTimes(1);
    expect(deps.listEvents).not.toHaveBeenCalled();
    expect(deps.listInsightRefs).toHaveBeenCalledWith(["session-1"]);
    expect(deps.listUsers).toHaveBeenCalledWith(["user-1"]);
    expect(deps.listDepartments).toHaveBeenCalledWith(["dept-1"]);
    expect(deps.getUser).not.toHaveBeenCalled();
    expect(deps.getDepartment).not.toHaveBeenCalled();
    expect(response.body.summary.totalRequests).toBe(1);
  });

  it("falls back to the full loaders when the batched ones are missing", async () => {
    const { app, deps } = createApp({ batched: false });
    const response = await request(app).get("/api/admin/monitoring/operations-insights?days=7");

    expect(response.status).toBe(200);
    expect(deps.listEvents).toHaveBeenCalledTimes(1);
    expect(deps.listSessions).toHaveBeenCalledWith(["session-1"]);
    expect(deps.getUser).toHaveBeenCalledWith("user-1");
    expect(deps.getDepartment).toHaveBeenCalledWith("dept-1");
    expect(response.body.summary.totalRequests).toBe(1);
  });

  it("reuses loaded inputs across filter and page changes until refresh=1", async () => {
    const { app, deps } = createApp();
    await request(app).get("/api/admin/monitoring/operations-insights?days=30");
    await request(app).get("/api/admin/monitoring/operations-insights?days=30&sessionPage=2&query=ada");
    expect(deps.listInsightEvents).toHaveBeenCalledTimes(1);

    await request(app).get("/api/admin/monitoring/operations-insights?days=7");
    await request(app).get("/api/admin/monitoring/operations-insights?days=30&model=gpt-5.6-sol");
    expect(deps.listInsightEvents).toHaveBeenCalledTimes(3);

    await request(app).get("/api/admin/monitoring/operations-insights?days=30&refresh=1");
    expect(deps.listInsightEvents).toHaveBeenCalledTimes(4);
  });

  it("does not keep a failed load in the cache", async () => {
    const { app, deps } = createApp();
    deps.listInsightEvents.mockRejectedValueOnce(new Error("database unavailable"));

    const failed = await request(app).get("/api/admin/monitoring/operations-insights?days=30");
    expect(failed.status).toBe(500);
    const retried = await request(app).get("/api/admin/monitoring/operations-insights?days=30");
    expect(retried.status).toBe(200);
    expect(deps.listInsightEvents).toHaveBeenCalledTimes(2);
  });

  it("loads every time when the cache is disabled", async () => {
    const { app, deps } = createApp({ operationsInsightsCacheTtlMs: 0 });
    await request(app).get("/api/admin/monitoring/operations-insights?days=30");
    await request(app).get("/api/admin/monitoring/operations-insights?days=30");
    expect(deps.listInsightEvents).toHaveBeenCalledTimes(2);
  });
});
