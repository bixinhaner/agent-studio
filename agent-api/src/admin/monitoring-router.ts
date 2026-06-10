import { Router, type Request, type Response, type RequestHandler } from "express";

import { buildOperationsInsights, type OperationsInsightsSessionSortKey } from "./operations-insights.js";
import type { AlertEventRepository } from "../persistence/alert-event-repository.js";
import type { AlertRuleRepository, CreateAlertRuleInput } from "../persistence/alert-rule-repository.js";
import type { CostProfileRepository, UpsertCostProfileInput } from "../persistence/cost-profile-repository.js";
import type { DepartmentRepository } from "../persistence/department-repository.js";
import type { NotificationRecordRepository } from "../persistence/notification-record-repository.js";
import type { OrganizationRepository } from "../persistence/organization-repository.js";
import type { QuotaPolicyRepository, UpsertQuotaPolicyInput } from "../persistence/quota-policy-repository.js";
import type { ResourceAccessLogRepository } from "../persistence/resource-access-log-repository.js";
import type { SessionRepository } from "../persistence/session-repository.js";
import type { UsageRollupRepository } from "../persistence/usage-rollup-repository.js";
import type { UsageLedgerService } from "../operations/usage-ledger-service.js";
import type { UserRepositoryLike } from "../persistence/user-repository.js";

type MonitoringRouterOptions = {
  requirePermission: (permissionKey: string) => RequestHandler;
  resourceAccessLogs: Pick<ResourceAccessLogRepository, "list">;
  usageLedger: Pick<UsageLedgerService, "buildOverview" | "buildRankings" | "buildTrends" | "listEvents">;
  usageRollups: Pick<UsageRollupRepository, "list">;
  sessions: Pick<SessionRepository, "listByIds">;
  users: Pick<UserRepositoryLike, "getById">;
  organizations: Pick<OrganizationRepository, "listByIds">;
  departments: Pick<DepartmentRepository, "getById">;
  quotaPolicies: Pick<QuotaPolicyRepository, "list" | "upsert" | "getById" | "update">;
  costProfiles: Pick<CostProfileRepository, "list" | "listActive" | "upsert" | "getById" | "update">;
  alertRules: Pick<AlertRuleRepository, "list" | "create" | "getById" | "update">;
  alertEvents: Pick<AlertEventRepository, "list" | "getById" | "update">;
  notificationRecords: Pick<NotificationRecordRepository, "list">;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function parsePositiveInt(value: unknown, fallback: number, min = 1, max = 365): number {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : typeof value === "number" ? Math.trunc(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const OPERATIONS_SESSION_SORT_KEYS = new Set([
  "sessionId",
  "userName",
  "model",
  "entryLabel",
  "pathLabel",
  "requestCount",
  "inputTokens",
  "cachedInputTokens",
  "outputTokens",
  "totalTokens",
  "estimatedCost",
  "internalCost",
  "lastActiveAt"
]);

function parseOperationsSortKey(value: unknown): OperationsInsightsSessionSortKey | undefined {
  const key = trimOrUndefined(typeof value === "string" ? value : undefined);
  return key && OPERATIONS_SESSION_SORT_KEYS.has(key) ? (key as OperationsInsightsSessionSortKey) : undefined;
}

function parseSortDirection(value: unknown): "asc" | "desc" | undefined {
  const direction = trimOrUndefined(typeof value === "string" ? value : undefined);
  return direction === "asc" || direction === "desc" ? direction : undefined;
}

function detailFromError(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败";
}

function toJsonArray<T>(value: T[]): T[] {
  return structuredClone(value);
}

function normalizeQuotaPolicyInput(body: Record<string, unknown>): UpsertQuotaPolicyInput {
  return {
    id: trimOrUndefined(body.id as string | null | undefined),
    organizationId: trimOrUndefined(body.organizationId as string | null | undefined),
    scopeType: body.scopeType === "department" ? "department" : "platform",
    scopeId: String(body.scopeId ?? ""),
    featureType: trimOrUndefined(body.featureType as string | null | undefined),
    model: trimOrUndefined(body.model as string | null | undefined),
    metricType: String(body.metricType ?? "internal_cost") as UpsertQuotaPolicyInput["metricType"],
    windowType: "daily",
    thresholdValue: (body.thresholdValue as string | number | undefined) ?? "0",
    enforcementMode: body.enforcementMode === "alert_only" ? "alert_only" : "soft_block",
    isActive: typeof body.isActive === "boolean" ? body.isActive : undefined
  };
}

function normalizeCostProfileInput(body: Record<string, unknown>): UpsertCostProfileInput {
  return {
    id: trimOrUndefined(body.id as string | null | undefined),
    organizationId: trimOrUndefined(body.organizationId as string | null | undefined),
    model: String(body.model ?? ""),
    inputTokenPrice: String(body.inputTokenPrice ?? "0"),
    cachedInputTokenPrice: String(body.cachedInputTokenPrice ?? "0"),
    outputTokenPrice: String(body.outputTokenPrice ?? "0"),
    internalCostMultiplier: String(body.internalCostMultiplier ?? "1"),
    isActive: typeof body.isActive === "boolean" ? body.isActive : undefined
  };
}

function normalizeAlertRuleInput(body: Record<string, unknown>): CreateAlertRuleInput {
  return {
    id: trimOrUndefined(body.id as string | null | undefined),
    organizationId: trimOrUndefined(body.organizationId as string | null | undefined),
    scopeType: body.scopeType === "department" ? "department" : "platform",
    scopeId: String(body.scopeId ?? ""),
    ruleType: String(body.ruleType ?? "quota_threshold") as CreateAlertRuleInput["ruleType"],
    name: String(body.name ?? ""),
    description: trimOrUndefined(body.description as string | null | undefined),
    conditions: body.conditions,
    channels: Array.isArray(body.channels) ? body.channels.filter((item): item is string => typeof item === "string") : undefined,
    isActive: typeof body.isActive === "boolean" ? body.isActive : undefined
  };
}

function pickObject<T extends Record<string, unknown>>(value: T, keys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (value[key] !== undefined) {
      result[key] = value[key];
    }
  }
  return result;
}

export function createMonitoringRouter(options: MonitoringRouterOptions): Router {
  const router = Router();

  router.get("/monitoring/overview", options.requirePermission("monitoring.read"), async (_req: Request, res: Response) => {
    try {
      const [usageEvents, accessLogs, alertEvents, notificationRecords] = await Promise.all([
        options.usageLedger.listEvents(),
        options.resourceAccessLogs.list(),
        options.alertEvents.list(),
        options.notificationRecords.list()
      ]);
      const usageOverview = options.usageLedger.buildOverview(usageEvents);

      res.json({
        overview: {
          totalEstimatedCost: usageOverview.totalEstimatedCost,
          totalInternalCost: usageOverview.totalInternalCost,
          totalRequests: usageOverview.totalRequests,
          totalUsageEvents: usageEvents.length,
          totalResourceAccessLogs: accessLogs.length,
          openAlertCount: alertEvents.filter((item) => item.status === "open").length,
          acknowledgedAlertCount: alertEvents.filter((item) => item.status === "acknowledged").length,
          notificationCount: notificationRecords.length
        },
        trends: usageOverview.trends
      });
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.get("/monitoring/rankings", options.requirePermission("monitoring.read"), async (_req: Request, res: Response) => {
    try {
      res.json({ rankings: options.usageLedger.buildRankings(await options.usageLedger.listEvents()) });
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.get("/monitoring/operations-insights", options.requirePermission("monitoring.read"), async (req: Request, res: Response) => {
    try {
      const days = parsePositiveInt(req.query.days, 30, 1, 90);
      const sessionPage = parsePositiveInt(req.query.sessionPage, 1, 1, 10_000);
      const sessionPageSize = parsePositiveInt(req.query.sessionPageSize, 20, 10, 100);
      const filters = {
        days,
        timeZone: trimOrUndefined(typeof req.query.timezone === "string" ? req.query.timezone : undefined) ?? "UTC",
        organizationId: trimOrUndefined(typeof req.query.organizationId === "string" ? req.query.organizationId : undefined),
        model: trimOrUndefined(typeof req.query.model === "string" ? req.query.model : undefined),
        path: trimOrUndefined(typeof req.query.path === "string" ? req.query.path : undefined),
        entry: trimOrUndefined(typeof req.query.entry === "string" ? req.query.entry : undefined),
        query: trimOrUndefined(typeof req.query.query === "string" ? req.query.query : undefined),
        sessionPage,
        sessionPageSize,
        sessionSortKey: parseOperationsSortKey(req.query.sessionSortKey),
        sessionSortDirection: parseSortDirection(req.query.sessionSortDirection)
      } as const;

      const usageEvents = await options.usageLedger.listEvents({
        organizationId: filters.organizationId,
        model: filters.model,
        from: new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      });

      const sessionIds = [...new Set(usageEvents.map((item) => trimOrUndefined(item.sessionId)).filter(Boolean) as string[])];
      const organizationIds = [
        ...new Set(usageEvents.map((item) => trimOrUndefined(item.organizationId)).filter(Boolean) as string[])
      ];
      const userIds = [...new Set(usageEvents.map((item) => trimOrUndefined(item.userId)).filter(Boolean) as string[])];
      const departmentIds = [
        ...new Set(usageEvents.map((item) => trimOrUndefined(item.departmentIdSnapshot)).filter(Boolean) as string[])
      ];

      const [sessions, organizations, users, departments] = await Promise.all([
        options.sessions.listByIds(sessionIds),
        options.organizations.listByIds(organizationIds),
        Promise.all(userIds.map(async (userId) => [userId, await options.users.getById(userId)] as const)),
        Promise.all(departmentIds.map(async (departmentId) => [departmentId, await options.departments.getById(departmentId)] as const))
      ]);

      res.json(
        buildOperationsInsights({
          usageEvents,
          sessionsById: new Map(sessions.map((item) => [item.sessionId, item] as const)),
          organizationsById: new Map(organizations.map((item) => [item.id, item] as const)),
          usersById: new Map(users.flatMap(([key, value]) => (value ? [[key, value] as const] : []))),
          departmentsById: new Map(departments),
          filters
        })
      );
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.get("/monitoring/trends", options.requirePermission("monitoring.read"), async (_req: Request, res: Response) => {
    try {
      res.json({ trends: options.usageLedger.buildTrends(await options.usageLedger.listEvents()) });
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.get(
    "/monitoring/resource-access-logs",
    options.requirePermission("audit.read"),
    async (req: Request, res: Response) => {
      try {
        const take = typeof req.query.take === "string" ? Number(req.query.take) : undefined;
        const resourceAccessLogs = await options.resourceAccessLogs.list({
          take: Number.isFinite(take) ? take : undefined
        });
        res.json({ resourceAccessLogs });
      } catch (error) {
        res.status(500).json({ detail: detailFromError(error) });
      }
    }
  );

  router.get("/monitoring/usage-events", options.requirePermission("monitoring.read"), async (req: Request, res: Response) => {
    try {
      const take = typeof req.query.take === "string" ? Number(req.query.take) : undefined;
      const usageEvents = await options.usageLedger.listEvents({
        take: Number.isFinite(take) ? take : undefined
      });
      res.json({ usageEvents });
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.get("/quota-policies", options.requirePermission("quota.read"), async (_req: Request, res: Response) => {
    try {
      res.json({ quotaPolicies: await options.quotaPolicies.list() });
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.post("/quota-policies", options.requirePermission("quota.write"), async (req: Request, res: Response) => {
    try {
      const quotaPolicy = await options.quotaPolicies.upsert(normalizeQuotaPolicyInput(req.body ?? {}));
      res.status(201).json({ quotaPolicy });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.patch("/quota-policies/:policyId", options.requirePermission("quota.write"), async (req: Request, res: Response) => {
    try {
      const existing = await options.quotaPolicies.getById(req.params.policyId);
      if (!existing) {
        res.status(404).json({ detail: "quota policy 不存在" });
        return;
      }
      const forbiddenIdentityFields = ["scopeType", "scopeId", "featureType", "model", "metricType", "windowType"].filter(
        (key) => req.body?.[key] !== undefined
      );
      if (forbiddenIdentityFields.length > 0) {
        res.status(400).json({
          detail: `quota policy identity fields are immutable: ${forbiddenIdentityFields.join(", ")}`
        });
        return;
      }
      const quotaPolicy = await options.quotaPolicies.update({
        id: req.params.policyId,
        changes: pickObject(req.body ?? {}, ["thresholdValue", "enforcementMode", "isActive"])
      });
      res.json({ quotaPolicy });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/cost-profiles", options.requirePermission("quota.read"), async (_req: Request, res: Response) => {
    try {
      res.json({ costProfiles: await options.costProfiles.list() });
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.post("/cost-profiles", options.requirePermission("quota.write"), async (req: Request, res: Response) => {
    try {
      const costProfile = await options.costProfiles.upsert(normalizeCostProfileInput(req.body ?? {}));
      res.status(201).json({ costProfile });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.patch("/cost-profiles/:profileId", options.requirePermission("quota.write"), async (req: Request, res: Response) => {
    try {
      const existing = await options.costProfiles.getById(req.params.profileId);
      if (!existing) {
        res.status(404).json({ detail: "cost profile 不存在" });
        return;
      }
      const costProfile = await options.costProfiles.update({
        id: req.params.profileId,
        changes: pickObject(req.body ?? {}, [
          "model",
          "inputTokenPrice",
          "cachedInputTokenPrice",
          "outputTokenPrice",
          "internalCostMultiplier",
          "isActive"
        ])
      });
      res.json({ costProfile });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/alert-rules", options.requirePermission("alert.read"), async (_req: Request, res: Response) => {
    try {
      res.json({ alertRules: await options.alertRules.list() });
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.post("/alert-rules", options.requirePermission("alert.write"), async (req: Request, res: Response) => {
    try {
      const alertRule = await options.alertRules.create(normalizeAlertRuleInput(req.body ?? {}));
      res.status(201).json({ alertRule });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.patch("/alert-rules/:ruleId", options.requirePermission("alert.write"), async (req: Request, res: Response) => {
    try {
      const existing = await options.alertRules.getById(req.params.ruleId);
      if (!existing) {
        res.status(404).json({ detail: "alert rule 不存在" });
        return;
      }
      const alertRule = await options.alertRules.update({
        id: req.params.ruleId,
        changes: pickObject(req.body ?? {}, ["name", "description", "conditions", "channels", "isActive"])
      });
      res.json({ alertRule });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/alert-events", options.requirePermission("alert.read"), async (_req: Request, res: Response) => {
    try {
      res.json({ alertEvents: await options.alertEvents.list() });
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.post("/alert-events/:eventId/acknowledge", options.requirePermission("alert.write"), async (req: Request, res: Response) => {
    try {
      const existing = await options.alertEvents.getById(req.params.eventId);
      if (!existing) {
        res.status(404).json({ detail: "alert event 不存在" });
        return;
      }
      const alertEvent = await options.alertEvents.update({
        id: req.params.eventId,
        changes: { status: "acknowledged" }
      });
      res.json({ alertEvent });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.get("/notification-records", options.requirePermission("alert.read"), async (_req: Request, res: Response) => {
    try {
      const notificationRecords = await options.notificationRecords.list();
      res.json({ notificationRecords: toJsonArray(notificationRecords) });
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  return router;
}
