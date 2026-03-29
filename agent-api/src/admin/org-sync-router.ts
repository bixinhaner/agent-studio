import { Router, type Request, type Response } from "express";

import { createDingTalkClient } from "../auth/dingtalk.js";
import { appConfig } from "../config.js";
import { getDbClient } from "../db/client.js";
import { DingTalkOrgProvider } from "../org-sync/dingtalk-org-provider.js";
import { AlertEvaluationService } from "../operations/alert-evaluation-service.js";
import { OrgSyncService, type OrgSyncRunInput } from "../org-sync/org-sync-service.js";
import { AlertEventRepository, type AlertEventRepositoryDb } from "../persistence/alert-event-repository.js";
import { AlertRuleRepository, type AlertRuleRepositoryDb } from "../persistence/alert-rule-repository.js";
import { DepartmentMembershipRepository, type DepartmentMembershipRepositoryDb } from "../persistence/department-membership-repository.js";
import { DepartmentRepository, type DepartmentRepositoryDb } from "../persistence/department-repository.js";
import { NotificationRecordRepository, type NotificationRecordRepositoryDb } from "../persistence/notification-record-repository.js";
import { NotificationDispatchService } from "../operations/notification-dispatch-service.js";
import { QuotaEvaluationService } from "../operations/quota-evaluation-service.js";
import { QuotaPolicyRepository, type QuotaPolicyRepositoryDb } from "../persistence/quota-policy-repository.js";
import { UsageRollupRepository, type UsageRollupRepositoryDb } from "../persistence/usage-rollup-repository.js";
import { SyncJobRepository, type SyncJobRepositoryDb, type SyncJobRecord } from "../persistence/sync-job-repository.js";
import { UserRepository, type UserRepositoryDb } from "../persistence/user-repository.js";

type SyncJobDetailLike = {
  id: string;
  status: string;
  summary?: unknown;
  events?: Array<Record<string, unknown>>;
  diffs?: Array<Record<string, unknown>>;
};

type OrgSyncRouterDependencies = {
  syncService: Pick<OrgSyncService, "run">;
  syncJobs: Pick<SyncJobRepository, "listRecent" | "getDetail">;
  quotaChecks: Pick<QuotaEvaluationService, "evaluate">;
  alerts?: Pick<AlertEvaluationService, "evaluateQuotaResult">;
};

type OrgSyncRouterOptions = {
  syncService?: Pick<OrgSyncService, "run">;
  syncJobs?: Pick<SyncJobRepository, "listRecent" | "getDetail">;
  quotaChecks?: Pick<QuotaEvaluationService, "evaluate">;
  alerts?: Pick<AlertEvaluationService, "evaluateQuotaResult">;
  db?: OrgSyncJobDb;
};

type OrgSyncJobDb = UserRepositoryDb & DepartmentRepositoryDb & DepartmentMembershipRepositoryDb & SyncJobRepositoryDb;
type OrgSyncQuotaDb = QuotaPolicyRepositoryDb & UsageRollupRepositoryDb;
type OrgSyncAlertDb = AlertRuleRepositoryDb & AlertEventRepositoryDb & NotificationRecordRepositoryDb;

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function detailFromError(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败";
}

function isOverlapError(error: unknown): boolean {
  return /already running/i.test(detailFromError(error));
}

function isMissingScopeError(error: unknown): boolean {
  return /scopeExternalId is required/i.test(detailFromError(error));
}

function normalizeJob(job: SyncJobRecord | SyncJobDetailLike | null | undefined) {
  if (!job) return null;
  return {
    ...job,
    summary: job.summary ?? null
  };
}

function getFailureDetail(job: SyncJobDetailLike | null | undefined): string {
  const summary = job?.summary;
  if (!summary || typeof summary !== "object") {
    return "组织同步失败";
  }
  const record = summary as { detail?: unknown; message?: unknown };
  if (typeof record.detail === "string" && record.detail.trim()) {
    return record.detail.trim();
  }
  if (typeof record.message === "string" && record.message.trim()) {
    return record.message.trim();
  }
  return "组织同步失败";
}

function createDefaultDependencies(db?: OrgSyncJobDb): OrgSyncRouterDependencies {
  const currentDb = db ?? (getDbClient() as unknown as OrgSyncJobDb);

  const users = new UserRepository(currentDb as UserRepositoryDb);
  const departments = new DepartmentRepository(currentDb as DepartmentRepositoryDb);
  const memberships = new DepartmentMembershipRepository(currentDb as DepartmentMembershipRepositoryDb);
  const syncJobs = new SyncJobRepository(currentDb as SyncJobRepositoryDb);
  const quotaDb = currentDb as unknown as OrgSyncQuotaDb;
  const alertDb = currentDb as unknown as OrgSyncAlertDb;
  const syncService = new OrgSyncService({
    provider: new DingTalkOrgProvider(createDingTalkClient(appConfig.dingtalk)),
    departments,
    users,
    memberships,
    jobs: syncJobs
  });
  const quotaChecks = new QuotaEvaluationService({
    policies: new QuotaPolicyRepository(quotaDb),
    rollups: new UsageRollupRepository(quotaDb)
  });
  const alerts = new AlertEvaluationService({
    alertRules: new AlertRuleRepository(alertDb),
    alertEvents: new AlertEventRepository(alertDb),
    notifications: new NotificationDispatchService({
      notifications: new NotificationRecordRepository(alertDb),
      dingtalk: ({ message }) => {
        const client = createDingTalkClient(appConfig.dingtalk);
        if (!client.sendWorkNotice) {
          throw new Error("DingTalk work notice sender is not available");
        }
        return client.sendWorkNotice({ message });
      }
    })
  });

  return {
    syncService,
    syncJobs,
    quotaChecks,
    alerts
  };
}

function resolveDependencies(options: OrgSyncRouterOptions = {}): () => OrgSyncRouterDependencies {
  let defaults: OrgSyncRouterDependencies | null = null;
  return () => {
    if (options.syncService && options.syncJobs) {
      return {
        syncService: options.syncService,
        syncJobs: options.syncJobs,
        quotaChecks: options.quotaChecks ?? createDefaultDependencies(options.db).quotaChecks,
        alerts: options.alerts ?? createDefaultDependencies(options.db).alerts
      };
    }
    defaults ??= createDefaultDependencies(options.db);
    return {
      syncService: options.syncService ?? defaults.syncService,
      syncJobs: options.syncJobs ?? defaults.syncJobs,
      quotaChecks: options.quotaChecks ?? defaults.quotaChecks,
      alerts: options.alerts ?? defaults.alerts
    };
  };
}

function sendFailure(res: Response, status: number, detail: string, job?: SyncJobDetailLike | null): void {
  res.status(status).json(job ? { detail, job: normalizeJob(job) } : { detail });
}

async function runSync(
  res: Response,
  deps: OrgSyncRouterDependencies,
  input: OrgSyncRunInput
): Promise<void> {
  try {
    const quotaDecision = await deps.quotaChecks?.evaluate({
      featureType: "sync",
      rollupDate: new Date()
    });
    if (quotaDecision?.decision === "soft_block") {
      if (deps.alerts && quotaDecision.policy && quotaDecision.thresholdValue !== undefined) {
        await deps.alerts.evaluateQuotaResult({
          scopeType: quotaDecision.policy.scopeType,
          scopeId: quotaDecision.policy.scopeId,
          metricType: quotaDecision.policy.metricType,
          triggeredValue: quotaDecision.observedValue,
          thresholdValue: quotaDecision.thresholdValue
        });
      }
      sendFailure(res, 403, "当前配额已超限，无法发起组织同步");
      return;
    }
    const result = await deps.syncService.run(input);
    const job = await deps.syncJobs.getDetail(result.jobId);
    if (result.status === "failed") {
      sendFailure(res, 502, getFailureDetail(job), job);
      return;
    }
    res.status(202).json({ job: normalizeJob(job) ?? { id: result.jobId, status: result.status } });
  } catch (error) {
    if (isOverlapError(error)) {
      sendFailure(res, 409, detailFromError(error));
      return;
    }
    if (isMissingScopeError(error)) {
      sendFailure(res, 400, detailFromError(error));
      return;
    }
    sendFailure(res, 500, detailFromError(error));
  }
}

export function createOrgSyncRouter(options: OrgSyncRouterOptions = {}): Router {
  const router = Router();
  const getDeps = resolveDependencies(options);

  router.post("/jobs", async (req: Request, res: Response) => {
    const triggeredByUserId = req.currentUser?.id;
    const deps = getDeps();
    await runSync(res, deps, {
      scopeType: "full",
      triggerType: "manual",
      triggeredByUserId
    });
  });

  router.post("/jobs/department/:externalId", async (req: Request, res: Response) => {
    const triggeredByUserId = req.currentUser?.id;
    const scopeExternalId = trimOrUndefined(req.params.externalId);
    const deps = getDeps();
    await runSync(res, deps, {
      scopeType: "department",
      scopeExternalId,
      triggerType: "manual",
      triggeredByUserId
    });
  });

  router.post("/jobs/user/:externalId", async (req: Request, res: Response) => {
    const triggeredByUserId = req.currentUser?.id;
    const scopeExternalId = trimOrUndefined(req.params.externalId);
    const deps = getDeps();
    await runSync(res, deps, {
      scopeType: "user",
      scopeExternalId,
      triggerType: "manual",
      triggeredByUserId
    });
  });

  router.get("/jobs", async (_req: Request, res: Response) => {
    try {
      const deps = getDeps();
      const jobs = await deps.syncJobs.listRecent();
      res.json({ jobs: jobs.map(normalizeJob) });
    } catch (error) {
      sendFailure(res, 500, detailFromError(error));
    }
  });

  router.get("/jobs/:jobId", async (req: Request, res: Response) => {
    try {
      const deps = getDeps();
      const job = await deps.syncJobs.getDetail(req.params.jobId);
      if (!job) {
        sendFailure(res, 404, "sync job 不存在");
        return;
      }
      res.json({ job: normalizeJob(job) });
    } catch (error) {
      sendFailure(res, 500, detailFromError(error));
    }
  });

  router.get("/jobs/:jobId/events", async (req: Request, res: Response) => {
    try {
      const deps = getDeps();
      const job = await deps.syncJobs.getDetail(req.params.jobId);
      if (!job) {
        sendFailure(res, 404, "sync job 不存在");
        return;
      }
      res.json({ events: job.events ?? [] });
    } catch (error) {
      sendFailure(res, 500, detailFromError(error));
    }
  });

  router.get("/jobs/:jobId/diffs", async (req: Request, res: Response) => {
    try {
      const deps = getDeps();
      const job = await deps.syncJobs.getDetail(req.params.jobId);
      if (!job) {
        sendFailure(res, 404, "sync job 不存在");
        return;
      }
      res.json({ diffs: job.diffs ?? [] });
    } catch (error) {
      sendFailure(res, 500, detailFromError(error));
    }
  });

  return router;
}
