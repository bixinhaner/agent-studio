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
import {
  OrganizationMembershipRepository,
  type OrganizationMembershipRepositoryDb
} from "../persistence/organization-membership-repository.js";
import { OrganizationRepository, type OrganizationRepositoryDb } from "../persistence/organization-repository.js";
import { NotificationRecordRepository, type NotificationRecordRepositoryDb } from "../persistence/notification-record-repository.js";
import { NotificationDispatchService } from "../operations/notification-dispatch-service.js";
import { QuotaEvaluationService } from "../operations/quota-evaluation-service.js";
import { QuotaPolicyRepository, type QuotaPolicyRepositoryDb } from "../persistence/quota-policy-repository.js";
import { UsageRollupRepository, type UsageRollupRepositoryDb } from "../persistence/usage-rollup-repository.js";
import { SyncJobRepository, type SyncJobRepositoryDb, type SyncJobRecord } from "../persistence/sync-job-repository.js";
import { UserRepository, type UserRepositoryDb } from "../persistence/user-repository.js";

type DepartmentLookupEntry = {
  externalId: string;
  name: string;
  path: string;
};

type SyncJobDetailLike = {
  id: string;
  status: string;
  summary?: unknown;
  events?: Array<Record<string, unknown>>;
  snapshots?: Array<Record<string, unknown>>;
  diffs?: Array<Record<string, unknown>>;
};

type OrgSyncRouterDependencies = {
  syncService: Pick<OrgSyncService, "run">;
  syncJobs: Pick<SyncJobRepository, "listRecent" | "getDetail">;
  departments?: Pick<DepartmentRepository, "listTree">;
  quotaChecks: Pick<QuotaEvaluationService, "evaluate">;
  alerts?: Pick<AlertEvaluationService, "evaluateQuotaResult">;
};

type OrgSyncRouterOptions = {
  syncService?: Pick<OrgSyncService, "run">;
  syncJobs?: Pick<SyncJobRepository, "listRecent" | "getDetail">;
  departments?: Pick<DepartmentRepository, "listTree">;
  quotaChecks?: Pick<QuotaEvaluationService, "evaluate">;
  alerts?: Pick<AlertEvaluationService, "evaluateQuotaResult">;
  db?: OrgSyncJobDb;
};

type OrgSyncJobDb =
  UserRepositoryDb &
  DepartmentRepositoryDb &
  DepartmentMembershipRepositoryDb &
  OrganizationRepositoryDb &
  OrganizationMembershipRepositoryDb &
  SyncJobRepositoryDb;
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
  const organizations = new OrganizationRepository(currentDb as OrganizationRepositoryDb);
  const organizationMemberships = new OrganizationMembershipRepository(currentDb as OrganizationMembershipRepositoryDb);
  const syncJobs = new SyncJobRepository(currentDb as SyncJobRepositoryDb);
  const quotaDb = currentDb as unknown as OrgSyncQuotaDb;
  const alertDb = currentDb as unknown as OrgSyncAlertDb;
  const syncService = new OrgSyncService({
    provider: new DingTalkOrgProvider(createDingTalkClient(appConfig.dingtalk)),
    departments,
    users,
    memberships,
    organizations,
    organizationMemberships,
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
    departments,
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
        departments: options.departments ?? createDefaultDependencies(options.db).departments,
        quotaChecks: options.quotaChecks ?? createDefaultDependencies(options.db).quotaChecks,
        alerts: options.alerts ?? createDefaultDependencies(options.db).alerts
      };
    }
    defaults ??= createDefaultDependencies(options.db);
    return {
      syncService: options.syncService ?? defaults.syncService,
      syncJobs: options.syncJobs ?? defaults.syncJobs,
      departments: options.departments ?? defaults.departments,
      quotaChecks: options.quotaChecks ?? defaults.quotaChecks,
      alerts: options.alerts ?? defaults.alerts
    };
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function addDepartmentLookupSource(
  sources: Map<string, { externalId: string; name: string; parentExternalId?: string }>,
  payload: unknown
): void {
  const record = asRecord(payload);
  const externalId = asString(record?.externalId);
  const name = asString(record?.name);
  if (!externalId || !name) return;
  sources.set(externalId, {
    externalId,
    name,
    parentExternalId: asString(record?.parentExternalId)
  });
}

function buildPath(
  externalId: string,
  sources: Map<string, { externalId: string; name: string; parentExternalId?: string }>,
  seen = new Set<string>()
): string {
  const source = sources.get(externalId);
  if (!source) return externalId;
  const parentExternalId = source.parentExternalId;
  if (!parentExternalId || parentExternalId === "1" || seen.has(externalId) || !sources.has(parentExternalId)) {
    return source.name;
  }
  seen.add(externalId);
  return `${buildPath(parentExternalId, sources, seen)} / ${source.name}`;
}

async function buildDepartmentLookup(
  job: SyncJobDetailLike,
  departments?: Pick<DepartmentRepository, "listTree">
): Promise<Record<string, DepartmentLookupEntry>> {
  const sources = new Map<string, { externalId: string; name: string; parentExternalId?: string }>();

  const addTreeNode = (node: Record<string, unknown>, parentExternalId?: string) => {
    const externalId = asString(node.externalId);
    const name = asString(node.name);
    if (externalId && name) {
      sources.set(externalId, { externalId, name, parentExternalId });
    }
    for (const child of asArray(node.children)) {
      const childRecord = asRecord(child);
      if (childRecord) {
        addTreeNode(childRecord, externalId);
      }
    }
  };

  if (departments) {
    for (const root of await departments.listTree()) {
      addTreeNode(root as unknown as Record<string, unknown>);
    }
  }

  for (const snapshot of job.snapshots ?? []) {
    if (snapshot.entityType !== "department") continue;
    for (const department of asArray(snapshot.snapshotPayload)) {
      addDepartmentLookupSource(sources, department);
    }
  }

  for (const diff of job.diffs ?? []) {
    if (diff.entityType !== "department") continue;
    addDepartmentLookupSource(sources, diff.beforePayload);
    addDepartmentLookupSource(sources, diff.afterPayload);
  }

  const lookup: Record<string, DepartmentLookupEntry> = {};
  for (const [externalId, source] of sources) {
    lookup[externalId] = {
      externalId,
      name: source.name,
      path: buildPath(externalId, sources)
    };
  }
  return lookup;
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
      const departmentLookup = await buildDepartmentLookup(job, deps.departments);
      res.json({ diffs: job.diffs ?? [], departmentLookup });
    } catch (error) {
      sendFailure(res, 500, detailFromError(error));
    }
  });

  return router;
}
