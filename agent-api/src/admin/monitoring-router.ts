import { Router, type Request, type Response, type RequestHandler } from "express";

import type { AlertEventRepository } from "../persistence/alert-event-repository.js";
import type { AlertRuleRepository, CreateAlertRuleInput } from "../persistence/alert-rule-repository.js";
import type { CostProfileRepository, UpsertCostProfileInput } from "../persistence/cost-profile-repository.js";
import type { NotificationRecordRepository } from "../persistence/notification-record-repository.js";
import type { QuotaPolicyRepository, UpsertQuotaPolicyInput } from "../persistence/quota-policy-repository.js";
import type { ResourceAccessLogRepository } from "../persistence/resource-access-log-repository.js";
import type { UsageDailyRollupRecord, UsageRollupRepository } from "../persistence/usage-rollup-repository.js";
import type { UsageEventRecord, UsageEventRepository } from "../persistence/usage-event-repository.js";

type MonitoringRouterOptions = {
  requirePermission: (permissionKey: string) => RequestHandler;
  resourceAccessLogs: Pick<ResourceAccessLogRepository, "list">;
  usageEvents: Pick<UsageEventRepository, "list">;
  usageRollups: Pick<UsageRollupRepository, "list">;
  quotaPolicies: Pick<QuotaPolicyRepository, "list" | "upsert" | "getById" | "update">;
  costProfiles: Pick<CostProfileRepository, "list" | "listActive" | "upsert" | "getById" | "update">;
  alertRules: Pick<AlertRuleRepository, "list" | "create" | "getById" | "update">;
  alertEvents: Pick<AlertEventRepository, "list" | "getById" | "update">;
  notificationRecords: Pick<NotificationRecordRepository, "list">;
};

type AggregatedRanking = {
  key: string;
  requestCount: number;
  estimatedCost: string;
  internalCost: string;
};

type MonitoringTrend = {
  rollupDate: string;
  requestCount: number;
  successCount: number;
  failureCount: number;
  estimatedCost: string;
  internalCost: string;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toDateKey(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const trimmed = value.trim();
  if (!trimmed) return new Date().toISOString().slice(0, 10);
  return trimmed.slice(0, 10);
}

function aggregateRankings<T extends UsageEventRecord>(
  records: T[],
  selectKey: (record: T) => string | undefined
): AggregatedRanking[] {
  const buckets = new Map<string, { requestCount: number; estimatedCost: number; internalCost: number }>();
  for (const record of records) {
    const key = trimOrUndefined(selectKey(record));
    if (!key) continue;
    const existing = buckets.get(key) ?? { requestCount: 0, estimatedCost: 0, internalCost: 0 };
    existing.requestCount += 1;
    existing.estimatedCost += toNumber(record.estimatedCost);
    existing.internalCost += toNumber(record.internalCost);
    buckets.set(key, existing);
  }

  return [...buckets.entries()]
    .map(([key, value]) => ({
      key,
      requestCount: value.requestCount,
      estimatedCost: value.estimatedCost.toFixed(6),
      internalCost: value.internalCost.toFixed(6)
    }))
    .sort(
      (left, right) =>
        right.requestCount - left.requestCount ||
        toNumber(right.estimatedCost) - toNumber(left.estimatedCost) ||
        left.key.localeCompare(right.key)
    );
}

function buildTrends(records: UsageDailyRollupRecord[]): MonitoringTrend[] {
  const buckets = new Map<string, MonitoringTrend>();
  for (const record of records) {
    const rollupDate = toDateKey(record.rollupDate);
    const existing = buckets.get(rollupDate) ?? {
      rollupDate,
      requestCount: 0,
      successCount: 0,
      failureCount: 0,
      estimatedCost: "0.000000",
      internalCost: "0.000000"
    };
    existing.requestCount += record.requestCount;
    existing.successCount += record.successCount;
    existing.failureCount += record.failureCount;
    existing.estimatedCost = (toNumber(existing.estimatedCost) + toNumber(record.estimatedCost)).toFixed(6);
    existing.internalCost = (toNumber(existing.internalCost) + toNumber(record.internalCost)).toFixed(6);
    buckets.set(rollupDate, existing);
  }
  return [...buckets.values()].sort((left, right) => left.rollupDate.localeCompare(right.rollupDate));
}

function isPlatformRollup(record: UsageDailyRollupRecord): boolean {
  return record.scopeType === "platform";
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
      const [usageRollups, usageEvents, accessLogs, alertEvents, notificationRecords] = await Promise.all([
        options.usageRollups.list(),
        options.usageEvents.list(),
        options.resourceAccessLogs.list(),
        options.alertEvents.list(),
        options.notificationRecords.list()
      ]);
      const platformRollups = usageRollups.filter(isPlatformRollup);
      const trends = buildTrends(platformRollups);
      const totalRequests = trends.reduce((sum, item) => sum + item.requestCount, 0);
      const totalEstimatedCost = platformRollups.reduce((sum, item) => sum + toNumber(item.estimatedCost), 0).toFixed(6);
      const totalInternalCost = platformRollups.reduce((sum, item) => sum + toNumber(item.internalCost), 0).toFixed(6);

      res.json({
        overview: {
          totalEstimatedCost,
          totalInternalCost,
          totalRequests,
          totalUsageEvents: usageEvents.length,
          totalResourceAccessLogs: accessLogs.length,
          openAlertCount: alertEvents.filter((item) => item.status === "open").length,
          acknowledgedAlertCount: alertEvents.filter((item) => item.status === "acknowledged").length,
          notificationCount: notificationRecords.length
        },
        trends
      });
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.get("/monitoring/rankings", options.requirePermission("monitoring.read"), async (_req: Request, res: Response) => {
    try {
      const usageEvents = await options.usageEvents.list();
      res.json({
        rankings: {
          topUsers: aggregateRankings(usageEvents, (record) => record.userId).map((item) => ({
            userId: item.key,
            requestCount: item.requestCount,
            estimatedCost: item.estimatedCost,
            internalCost: item.internalCost
          })),
          topDepartments: aggregateRankings(usageEvents, (record) => record.departmentIdSnapshot).map((item) => ({
            departmentId: item.key,
            requestCount: item.requestCount,
            estimatedCost: item.estimatedCost,
            internalCost: item.internalCost
          })),
          topModels: aggregateRankings(usageEvents, (record) => record.model).map((item) => ({
            model: item.key,
            requestCount: item.requestCount,
            estimatedCost: item.estimatedCost,
            internalCost: item.internalCost
          })),
          topFeatures: aggregateRankings(usageEvents, (record) => record.featureType).map((item) => ({
            featureType: item.key,
            requestCount: item.requestCount,
            estimatedCost: item.estimatedCost,
            internalCost: item.internalCost
          }))
        }
      });
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.get("/monitoring/trends", options.requirePermission("monitoring.read"), async (_req: Request, res: Response) => {
    try {
      res.json({ trends: buildTrends((await options.usageRollups.list()).filter(isPlatformRollup)) });
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
      const usageEvents = await options.usageEvents.list({
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
