import express, { Router, type RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { registerCommonApiRoutes } from "../app-routes.js";
import { createMonitoringRouter } from "./monitoring-router.js";

type MonitoringRecord = Record<string, unknown>;

function makeDate(value: string): string {
  return new Date(value).toISOString();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function formatDecimal(value: unknown, digits = 6): string {
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed.toFixed(digits) : value;
  }
  if (typeof value === "number") {
    return value.toFixed(digits);
  }
  return digits === 4 ? "1.0000" : "0.000000";
}

function buildPermissionGuard(allowedPermissions: string[]): (permissionKey: string) => RequestHandler {
  const allowed = new Set(allowedPermissions);
  return (permissionKey: string) => (req, res, next) => {
    if (!allowed.has(permissionKey)) {
      res.status(403).json({ detail: "Forbidden" });
      return;
    }
    if (!req.currentUser) {
      res.status(401).json({ detail: "Unauthorized" });
      return;
    }
    next();
  };
}

function makeListTable<T extends MonitoringRecord>(rows: T[]) {
  return {
    list: async () => clone(rows)
  };
}

function makeCrudTable<T extends MonitoringRecord & { id: string }>(rows: T[]) {
  function normalize(input: MonitoringRecord): MonitoringRecord {
    const normalized = clone(input);
    if ("thresholdValue" in normalized) {
      normalized.thresholdValue = formatDecimal(normalized.thresholdValue, 6);
    }
    if ("inputTokenPrice" in normalized) {
      normalized.inputTokenPrice = formatDecimal(normalized.inputTokenPrice, 6);
    }
    if ("cachedInputTokenPrice" in normalized) {
      normalized.cachedInputTokenPrice = formatDecimal(normalized.cachedInputTokenPrice, 6);
    }
    if ("outputTokenPrice" in normalized) {
      normalized.outputTokenPrice = formatDecimal(normalized.outputTokenPrice, 6);
    }
    if ("internalCostMultiplier" in normalized) {
      normalized.internalCostMultiplier = formatDecimal(normalized.internalCostMultiplier, 4);
    }
    return normalized;
  }

  return {
    list: async () => clone(rows),
    getById: async (id: string) => clone(rows.find((row) => row.id === id) ?? null),
    upsert: async (input: MonitoringRecord) => {
      const normalized = normalize(input);
      const id = typeof input.id === "string" ? input.id : `${rows.length + 1}`;
      const existing = rows.find((row) => row.id === id);
      if (existing) {
        Object.assign(existing, { ...normalized, id }, { updatedAt: new Date().toISOString() });
        return clone(existing);
      }
      const row = { ...normalized, id } as T;
      rows.push(row);
      return clone(row);
    },
    create: async (input: MonitoringRecord) => {
      const normalized = normalize(input);
      const id = typeof input.id === "string" ? input.id : `${rows.length + 1}`;
      const row = { ...normalized, id } as T;
      rows.push(row);
      return clone(row);
    },
    update: async ({ id, changes }: { id: string; changes: MonitoringRecord }) => {
      const row = rows.find((item) => item.id === id);
      if (!row) {
        throw new Error("record not found");
      }
      Object.assign(row, normalize(changes), { updatedAt: new Date().toISOString() });
      return clone(row);
    }
  };
}

function makeCostProfileTable<T extends MonitoringRecord & { id: string; isActive?: boolean; organizationId?: string | null }>(rows: T[]) {
  const table = makeCrudTable(rows);
  return {
    ...table,
    listActive: async () => clone(rows.filter((row) => row.isActive && !row.organizationId)),
    list: async () => clone(rows)
  };
}

function buildMonitoringApp(options?: { allowedPermissions?: string[] }) {
  const allowedPermissions = options?.allowedPermissions ?? [
    "monitoring.read",
    "audit.read",
    "quota.read",
    "quota.write",
    "alert.read",
    "alert.write"
  ];

  const usageDailyRollups = [
    {
      id: "rollup-1",
      organizationId: null,
      rollupDate: "2026-03-28",
      scopeType: "platform",
      scopeId: "platform",
      model: null,
      featureType: null,
      requestCount: 8,
      successCount: 7,
      failureCount: 1,
      inputTokens: 100,
      cachedInputTokens: 20,
      outputTokens: 80,
      estimatedCost: "10.000000",
      internalCost: "6.000000",
      createdAt: makeDate("2026-03-28T12:00:00.000Z"),
      updatedAt: makeDate("2026-03-28T12:00:00.000Z")
    },
    {
      id: "rollup-2",
      organizationId: null,
      rollupDate: "2026-03-29",
      scopeType: "platform",
      scopeId: "platform",
      model: null,
      featureType: null,
      requestCount: 4,
      successCount: 4,
      failureCount: 0,
      inputTokens: 60,
      cachedInputTokens: 10,
      outputTokens: 50,
      estimatedCost: "5.000000",
      internalCost: "3.000000",
      createdAt: makeDate("2026-03-29T12:00:00.000Z"),
      updatedAt: makeDate("2026-03-29T12:00:00.000Z")
    },
    {
      id: "rollup-3",
      organizationId: null,
      rollupDate: "2026-03-29",
      scopeType: "department",
      scopeId: "dept-rd",
      model: null,
      featureType: null,
      requestCount: 9,
      successCount: 8,
      failureCount: 1,
      inputTokens: 90,
      cachedInputTokens: 0,
      outputTokens: 70,
      estimatedCost: "9.000000",
      internalCost: "4.000000",
      createdAt: makeDate("2026-03-29T12:00:00.000Z"),
      updatedAt: makeDate("2026-03-29T12:00:00.000Z")
    }
  ];
  const usageEvents = [
    {
      id: "usage-1",
      organizationId: null,
      userId: "user-1",
      departmentIdSnapshot: "dept-rd",
      threadId: "thread-1",
      sessionId: "session-1",
      model: "gpt-5.4",
      featureType: "chat",
      inputTokens: 100,
      cachedInputTokens: 10,
      outputTokens: 40,
      estimatedCost: "3.000000",
      internalCost: "1.200000",
      resultStatus: "success",
      metadata: { scope: "chat" },
      createdAt: makeDate("2026-03-29T08:00:00.000Z")
    },
    {
      id: "usage-2",
      organizationId: null,
      userId: "user-1",
      departmentIdSnapshot: "dept-rd",
      threadId: "thread-2",
      sessionId: "session-2",
      model: "gpt-5.4",
      featureType: "chat",
      inputTokens: 110,
      cachedInputTokens: 0,
      outputTokens: 50,
      estimatedCost: "2.000000",
      internalCost: "1.000000",
      resultStatus: "success",
      metadata: { scope: "chat" },
      createdAt: makeDate("2026-03-29T09:00:00.000Z")
    },
    {
      id: "usage-3",
      organizationId: null,
      userId: "user-2",
      departmentIdSnapshot: "dept-ops",
      threadId: "thread-3",
      sessionId: "session-3",
      model: "gpt-4.1",
      featureType: "agent",
      inputTokens: 30,
      cachedInputTokens: 0,
      outputTokens: 20,
      estimatedCost: "1.000000",
      internalCost: "0.400000",
      resultStatus: "success",
      metadata: { scope: "agent" },
      createdAt: makeDate("2026-03-29T10:00:00.000Z")
    },
    {
      id: "usage-4",
      organizationId: null,
      userId: "user-3",
      departmentIdSnapshot: "dept-fin",
      threadId: "thread-4",
      sessionId: "session-4",
      model: "claude-code",
      featureType: "tool",
      inputTokens: 50,
      cachedInputTokens: 0,
      outputTokens: 25,
      estimatedCost: "10.000000",
      internalCost: "5.000000",
      resultStatus: "success",
      metadata: { scope: "tool" },
      createdAt: makeDate("2026-03-29T11:00:00.000Z")
    },
    {
      id: "usage-5",
      organizationId: null,
      userId: "user-4",
      departmentIdSnapshot: "dept-fin",
      threadId: "thread-5",
      sessionId: "session-5",
      model: "claude-code",
      featureType: "tool",
      inputTokens: 40,
      cachedInputTokens: 0,
      outputTokens: 20,
      estimatedCost: "9.000000",
      internalCost: "4.500000",
      resultStatus: "success",
      metadata: { scope: "tool" },
      createdAt: makeDate("2026-03-29T11:05:00.000Z")
    }
  ];
  const resourceAccessLogs = [
    {
      id: "access-1",
      organizationId: null,
      userId: "user-1",
      departmentIdSnapshot: "dept-rd",
      threadId: "thread-1",
      sessionId: "session-1",
      resourceType: "knowledge_set",
      resourceId: "ks-1",
      actionType: "mount",
      resultStatus: "success",
      metadata: { source: "admin" },
      createdAt: makeDate("2026-03-29T08:05:00.000Z")
    },
    {
      id: "access-2",
      organizationId: null,
      userId: "user-2",
      departmentIdSnapshot: "dept-ops",
      threadId: "thread-3",
      sessionId: "session-3",
      resourceType: "permission",
      resourceId: "quota.read",
      actionType: "deny",
      resultStatus: "denied",
      metadata: { source: "guard" },
      createdAt: makeDate("2026-03-29T10:05:00.000Z")
    }
  ];
  const quotaPolicies = [
    {
      id: "policy-1",
      organizationId: null,
      scopeType: "department",
      scopeId: "dept-rd",
      featureType: "chat",
      model: null,
      metricType: "internal_cost",
      windowType: "daily",
      thresholdValue: "100.000000",
      enforcementMode: "soft_block",
      isActive: true,
      createdAt: makeDate("2026-03-29T00:00:00.000Z"),
      updatedAt: makeDate("2026-03-29T00:00:00.000Z")
    }
  ];
  const costProfiles = [
    {
      id: "profile-1",
      organizationId: null,
      model: "gpt-5.4",
      inputTokenPrice: "0.010000",
      cachedInputTokenPrice: "0.002000",
      outputTokenPrice: "0.020000",
      internalCostMultiplier: "1.2000",
      isActive: true,
      createdAt: makeDate("2026-03-29T00:00:00.000Z"),
      updatedAt: makeDate("2026-03-29T00:00:00.000Z")
    },
    {
      id: "profile-2",
      organizationId: "org-1",
      model: "gpt-4.1",
      inputTokenPrice: "0.020000",
      cachedInputTokenPrice: "0.004000",
      outputTokenPrice: "0.030000",
      internalCostMultiplier: "1.1000",
      isActive: false,
      createdAt: makeDate("2026-03-29T00:05:00.000Z"),
      updatedAt: makeDate("2026-03-29T00:05:00.000Z")
    },
    {
      id: "profile-3",
      organizationId: "org-1",
      model: "claude-code",
      inputTokenPrice: "0.030000",
      cachedInputTokenPrice: "0.006000",
      outputTokenPrice: "0.040000",
      internalCostMultiplier: "1.3000",
      isActive: true,
      createdAt: makeDate("2026-03-29T00:10:00.000Z"),
      updatedAt: makeDate("2026-03-29T00:10:00.000Z")
    }
  ];
  const alertRules = [
    {
      id: "alert-rule-1",
      organizationId: null,
      scopeType: "department",
      scopeId: "dept-rd",
      ruleType: "quota_threshold",
      name: "RD quota alert",
      description: "Warn when quota is exceeded",
      conditions: { metricType: "internal_cost" },
      channels: ["dingtalk"],
      isActive: true,
      createdAt: makeDate("2026-03-29T00:00:00.000Z"),
      updatedAt: makeDate("2026-03-29T00:00:00.000Z")
    }
  ];
  const alertEvents = [
    {
      id: "alert-event-1",
      organizationId: null,
      alertRuleId: "alert-rule-1",
      scopeType: "department",
      scopeId: "dept-rd",
      severity: "critical",
      status: "open",
      title: "Quota exceeded",
      detail: "Department quota crossed the threshold",
      payload: { triggeredValue: 120 },
      createdAt: makeDate("2026-03-29T11:00:00.000Z"),
      updatedAt: makeDate("2026-03-29T11:00:00.000Z")
    },
    {
      id: "alert-event-2",
      organizationId: null,
      alertRuleId: "alert-rule-1",
      scopeType: "department",
      scopeId: "dept-ops",
      severity: "warning",
      status: "acknowledged",
      title: "Rate spike",
      detail: "Temporary spike acknowledged",
      payload: { triggeredValue: 90 },
      createdAt: makeDate("2026-03-29T11:05:00.000Z"),
      updatedAt: makeDate("2026-03-29T11:10:00.000Z")
    }
  ];
  const notificationRecords = [
    {
      id: "notification-1",
      organizationId: null,
      channelType: "dingtalk",
      targetRef: "dept-rd",
      eventType: "alert.event.created",
      status: "sent",
      payload: { eventId: "alert-event-1" },
      errorMessage: null,
      createdAt: makeDate("2026-03-29T11:00:05.000Z"),
      updatedAt: makeDate("2026-03-29T11:00:05.000Z")
    }
  ];

  const monitoringRouter = createMonitoringRouter({
    requirePermission: buildPermissionGuard(allowedPermissions),
    resourceAccessLogs: makeListTable(resourceAccessLogs),
    usageEvents: makeListTable(usageEvents),
    usageRollups: makeListTable(usageDailyRollups),
    quotaPolicies: makeCrudTable(quotaPolicies),
    costProfiles: makeCostProfileTable(costProfiles),
    alertRules: makeCrudTable(alertRules),
    alertEvents: makeCrudTable(alertEvents),
    notificationRecords: makeListTable(notificationRecords)
  } as any);

  const app = express();
  app.use(express.json());
  registerCommonApiRoutes(app, {
    currentUserMiddleware: (req, _res, next) => {
      req.currentUser = {
        id: "admin-1",
        role: "admin",
        status: "active",
        createdAt: makeDate("2026-03-29T00:00:00.000Z"),
        updatedAt: makeDate("2026-03-29T00:00:00.000Z")
      };
      next();
    },
    authRouter: Router(),
    adminRouter: Router(),
    monitoringAdminRouter: monitoringRouter,
    portalRouter: Router(),
    serviceTokenMiddleware: (_req, _res, next) => next(),
    zendeskRouter: Router()
  });

  return { app, quotaPolicies, costProfiles, alertRules, alertEvents };
}

describe("monitoring admin router", () => {
  it("rejects monitoring routes when the permission guard denies access", async () => {
    const { app } = buildMonitoringApp({
      allowedPermissions: ["audit.read", "quota.read", "quota.write", "alert.read", "alert.write"]
    });

    const response = await request(app).get("/api/admin/monitoring/overview");

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ detail: "Forbidden" });
  });

  it("returns overview, rankings, and trends data", async () => {
    const { app } = buildMonitoringApp();

    const overviewResponse = await request(app).get("/api/admin/monitoring/overview");
    const rankingsResponse = await request(app).get("/api/admin/monitoring/rankings");
    const trendsResponse = await request(app).get("/api/admin/monitoring/trends");

    expect(overviewResponse.status).toBe(200);
    expect(overviewResponse.body.overview.totalEstimatedCost).toBe("15.000000");
    expect(overviewResponse.body.overview.totalInternalCost).toBe("9.000000");
    expect(overviewResponse.body.trends).toHaveLength(2);
    expect(rankingsResponse.status).toBe(200);
    expect(rankingsResponse.body.rankings.topUsers[0]).toMatchObject({
      userId: "user-1",
      requestCount: 2,
      estimatedCost: "5.000000"
    });
    expect(rankingsResponse.body.rankings.topUsers[1]).toMatchObject({
      userId: "user-3",
      requestCount: 1,
      estimatedCost: "10.000000"
    });
    expect(trendsResponse.status).toBe(200);
    expect(trendsResponse.body.trends[0]).toMatchObject({
      rollupDate: "2026-03-28",
      requestCount: 8
    });
    expect(trendsResponse.body.trends[1]).toMatchObject({
      rollupDate: "2026-03-29",
      requestCount: 4,
      estimatedCost: "5.000000"
    });
  });

  it("creates and updates quota policies, cost profiles, and alerts", async () => {
    const { app } = buildMonitoringApp();

    const quotaCreateResponse = await request(app).post("/api/admin/quota-policies").send({
      scopeType: "department",
      scopeId: "dept-ops",
      featureType: "chat",
      metricType: "internal_cost",
      windowType: "daily",
      thresholdValue: "150.00",
      enforcementMode: "soft_block"
    });
    expect(quotaCreateResponse.status).toBe(201);
    expect(quotaCreateResponse.body.quotaPolicy.scopeId).toBe("dept-ops");

    const quotaPatchResponse = await request(app)
      .patch(`/api/admin/quota-policies/${quotaCreateResponse.body.quotaPolicy.id}`)
      .send({ thresholdValue: "200.00", isActive: false });
    expect(quotaPatchResponse.status).toBe(200);
    expect(quotaPatchResponse.body.quotaPolicy.thresholdValue).toBe("200.000000");
    expect(quotaPatchResponse.body.quotaPolicy.isActive).toBe(false);

    const costCreateResponse = await request(app).post("/api/admin/cost-profiles").send({
      model: "gpt-4.1",
      inputTokenPrice: "0.020000",
      cachedInputTokenPrice: "0.004000",
      outputTokenPrice: "0.030000",
      internalCostMultiplier: "1.5000"
    });
    expect(costCreateResponse.status).toBe(201);
    expect(costCreateResponse.body.costProfile.model).toBe("gpt-4.1");

    const costPatchResponse = await request(app)
      .patch(`/api/admin/cost-profiles/${costCreateResponse.body.costProfile.id}`)
      .send({ outputTokenPrice: "0.031000" });
    expect(costPatchResponse.status).toBe(200);
    expect(costPatchResponse.body.costProfile.outputTokenPrice).toBe("0.031000");

    const costProfilesResponse = await request(app).get("/api/admin/cost-profiles");
    expect(costProfilesResponse.status).toBe(200);
    expect(costProfilesResponse.body.costProfiles).toHaveLength(4);
    expect(costProfilesResponse.body.costProfiles.map((profile: { id: string }) => profile.id)).toEqual([
      "profile-1",
      "profile-2",
      "profile-3",
      costCreateResponse.body.costProfile.id
    ]);

    const alertRuleCreateResponse = await request(app).post("/api/admin/alert-rules").send({
      scopeType: "platform",
      scopeId: "platform",
      ruleType: "security_event",
      name: "Security event alert",
      conditions: { severity: "critical" },
      channels: ["dingtalk"]
    });
    expect(alertRuleCreateResponse.status).toBe(201);
    expect(alertRuleCreateResponse.body.alertRule.name).toBe("Security event alert");

    const alertRulePatchResponse = await request(app)
      .patch(`/api/admin/alert-rules/${alertRuleCreateResponse.body.alertRule.id}`)
      .send({ isActive: false, name: "Updated security event alert" });
    expect(alertRulePatchResponse.status).toBe(200);
    expect(alertRulePatchResponse.body.alertRule.isActive).toBe(false);

    const alertEventsResponse = await request(app).get("/api/admin/alert-events");
    expect(alertEventsResponse.status).toBe(200);
    expect(alertEventsResponse.body.alertEvents).toHaveLength(2);

    const acknowledgeResponse = await request(app)
      .post("/api/admin/alert-events/alert-event-1/acknowledge")
      .send({ acknowledgedBy: "admin-1" });
    expect(acknowledgeResponse.status).toBe(200);
    expect(acknowledgeResponse.body.alertEvent.status).toBe("acknowledged");

    const notificationRecordsResponse = await request(app).get("/api/admin/notification-records");
    expect(notificationRecordsResponse.status).toBe(200);
    expect(notificationRecordsResponse.body.notificationRecords[0]).toMatchObject({
      channelType: "dingtalk",
      status: "sent"
    });
  });

  it("rejects quota policy identity changes during patch updates", async () => {
    const { app, quotaPolicies } = buildMonitoringApp();

    const response = await request(app).patch("/api/admin/quota-policies/policy-1").send({
      scopeId: "dept-ops",
      thresholdValue: "250.00"
    });

    expect(response.status).toBe(400);
    expect(response.body.detail).toContain("identity");
    expect(quotaPolicies).toHaveLength(1);
    expect(quotaPolicies[0]?.scopeId).toBe("dept-rd");
    expect(quotaPolicies[0]?.thresholdValue).toBe("100.000000");
  });
});
