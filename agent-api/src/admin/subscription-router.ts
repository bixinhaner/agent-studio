import type { PrismaClient } from "@prisma/client";
import { Router, type Request, type Response } from "express";

import { getDbClient } from "../db/client.js";
import { SubscriptionEntitlementService } from "../operations/subscription-entitlement-service.js";
import { SubscriptionDenialLogRepository } from "../persistence/subscription-denial-log-repository.js";
import {
  SubscriptionGrantRepository,
  type SubscriptionGrantRecord,
  type SubscriptionPrincipalType
} from "../persistence/subscription-grant-repository.js";
import { SubscriptionPlanRepository, type SubscriptionPlanRecord } from "../persistence/subscription-plan-repository.js";
import { UsageEventRepository } from "../persistence/usage-event-repository.js";

type SubscriptionAdminDb = PrismaClient;

type SubscriptionRouterOptions = {
  getDb?: () => SubscriptionAdminDb;
};

type OrganizationSummary = {
  id: string;
  name: string;
  slug: string;
  type: string;
  status?: string;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function parseOptionalDate(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new Error("时间格式不正确");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("时间格式不正确");
  }
  return parsed.toISOString();
}

function parseRequiredDate(value: unknown, fieldLabel: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldLabel}不能为空`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldLabel}格式不正确`);
  }
  return parsed.toISOString();
}

function parseOptionalNonNegativeInteger(value: unknown, fieldLabel: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${fieldLabel}只能填写 0 或正整数`);
  }
  return parsed;
}

function normalizeStatus(value: unknown): string | undefined {
  const status = trimOrUndefined(typeof value === "string" ? value : undefined);
  if (!status) return undefined;
  if (!["active", "paused"].includes(status)) {
    throw new Error("状态只支持 active 或 paused");
  }
  return status;
}

function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function isExpiringSoon(value: string | null | undefined, now: Date): boolean {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date <= now) return false;
  return date.getTime() - now.getTime() <= 7 * 24 * 60 * 60 * 1000;
}

function pickUserOrganization(user: {
  primaryOrganization: { id: string; name: string; slug: string; type: string; status: string } | null;
  organizationMemberships: Array<{
    organization: { id: string; name: string; slug: string; type: string; status: string } | null;
  }>;
}): OrganizationSummary | null {
  if (user.primaryOrganization) {
    return {
      id: user.primaryOrganization.id,
      name: user.primaryOrganization.name,
      slug: user.primaryOrganization.slug,
      type: user.primaryOrganization.type,
      status: user.primaryOrganization.status
    };
  }
  const firstMembership = user.organizationMemberships.find((item) => item.organization);
  if (!firstMembership?.organization) return null;
  return {
    id: firstMembership.organization.id,
    name: firstMembership.organization.name,
    slug: firstMembership.organization.slug,
    type: firstMembership.organization.type,
    status: firstMembership.organization.status
  };
}

function accessFromDefault(organizationType: string | null | undefined) {
  if (organizationType === "internal") {
    return {
      status: "available",
      title: "默认可用",
      description: "内部组织未单独配置时默认不限制使用。"
    };
  }
  return {
    status: "restricted",
    title: "待开通",
    description: "外部组织未配置时默认不能继续提问。"
  };
}

function sourceFromDefault(organizationType: string | null | undefined) {
  if (organizationType === "internal") {
    return {
      mode: "default_internal",
      label: "内部默认放行",
      planName: null
    };
  }
  return {
    mode: "default_external",
    label: "需先开通",
    planName: null
  };
}

function mapGrantSummary(
  evaluation: Awaited<ReturnType<SubscriptionEntitlementService["evaluateGrant"]>>
) {
  return {
    id: evaluation.grant.id,
    planId: evaluation.grant.planId ?? null,
    planName: evaluation.plan?.name ?? null,
    planSlug: evaluation.plan?.slug ?? null,
    status: evaluation.grant.status,
    startsAt: evaluation.grant.startsAt,
    expiresAt: evaluation.grant.expiresAt ?? null,
    cycleAnchorAt: evaluation.grant.cycleAnchorAt,
    note: evaluation.grant.note ?? null,
    completedTurnLimitOverride: evaluation.grant.completedTurnLimitOverride ?? null,
    tokenLimitOverride: evaluation.grant.tokenLimitOverride ?? null,
    monthlyCompletedTurnLimit: evaluation.limits.monthlyCompletedTurnLimit,
    monthlyTokenLimit: evaluation.limits.monthlyTokenLimit,
    usage: evaluation.usage
      ? {
          cycleStartsAt: evaluation.usage.cycleStartsAt,
          cycleEndsAt: evaluation.usage.cycleEndsAt,
          usedCompletedTurns: evaluation.usage.usedCompletedTurns,
          usedTokens: evaluation.usage.usedTokens,
          remainingCompletedTurns: evaluation.usage.remainingCompletedTurns,
          remainingTokens: evaluation.usage.remainingTokens
        }
      : null,
    access: {
      status: evaluation.access.status,
      title: evaluation.access.title,
      description: evaluation.access.description,
      reasonCode: evaluation.access.reasonCode
    }
  };
}

export function createSubscriptionRouter(options: SubscriptionRouterOptions = {}): Router {
  const router = Router();
  let cachedDb: SubscriptionAdminDb | null = null;
  let cachedPlans: SubscriptionPlanRepository | null = null;
  let cachedGrants: SubscriptionGrantRepository | null = null;
  let cachedDenialLogs: SubscriptionDenialLogRepository | null = null;
  let cachedService: SubscriptionEntitlementService | null = null;

  function getDb(): SubscriptionAdminDb {
    cachedDb ??= options.getDb?.() ?? getDbClient();
    return cachedDb;
  }

  function getPlans() {
    cachedPlans ??= new SubscriptionPlanRepository(getDb() as never);
    return cachedPlans;
  }

  function getGrants() {
    cachedGrants ??= new SubscriptionGrantRepository(getDb() as never);
    return cachedGrants;
  }

  function getDenialLogs() {
    cachedDenialLogs ??= new SubscriptionDenialLogRepository(getDb() as never);
    return cachedDenialLogs;
  }

  function getService() {
    cachedService ??= new SubscriptionEntitlementService({
      grants: getGrants(),
      plans: getPlans(),
      usageEvents: new UsageEventRepository(getDb() as never),
      denialLogs: getDenialLogs()
    });
    return cachedService;
  }

  router.get("/subscriptions/plans", async (_req: Request, res: Response) => {
    try {
      const [plans, grants] = await Promise.all([getPlans().list(), getGrants().list()]);
      const assignmentCounts = grants.reduce<Record<string, { users: number; organizations: number }>>((acc, grant) => {
        if (!grant.planId) return acc;
        acc[grant.planId] ??= { users: 0, organizations: 0 };
        if (grant.principalType === "user") {
          acc[grant.planId].users += 1;
        } else {
          acc[grant.planId].organizations += 1;
        }
        return acc;
      }, {});

      res.json({
        plans: plans.map((plan) => ({
          ...plan,
          assignmentCount: assignmentCounts[plan.id] ?? { users: 0, organizations: 0 }
        }))
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "加载套餐失败";
      res.status(500).json({ detail });
    }
  });

  router.post("/subscriptions/plans", async (req: Request, res: Response) => {
    try {
      const name = trimOrUndefined(req.body?.name);
      if (!name) {
        res.status(400).json({ detail: "套餐名称不能为空" });
        return;
      }
      const slug = trimOrUndefined(req.body?.slug) ?? toSlug(name);
      if (!slug) {
        res.status(400).json({ detail: "套餐标识不能为空" });
        return;
      }
      const plan = await getPlans().create({
        name,
        slug,
        description: trimOrUndefined(req.body?.description) ?? null,
        status: normalizeStatus(req.body?.status) ?? "active",
        featureType: "chat",
        monthlyCompletedTurnLimit: parseOptionalNonNegativeInteger(req.body?.monthlyCompletedTurnLimit, "每月 AI Request"),
        monthlyTokenLimit: parseOptionalNonNegativeInteger(req.body?.monthlyTokenLimit, "每月服务额度")
      });
      res.status(201).json({
        plan: {
          ...plan,
          assignmentCount: { users: 0, organizations: 0 }
        }
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "创建套餐失败";
      res.status(400).json({ detail });
    }
  });

  router.patch("/subscriptions/plans/:planId", async (req: Request, res: Response) => {
    try {
      const plan = await getPlans().update(req.params.planId, {
        name: req.body?.name === undefined ? undefined : trimOrUndefined(req.body?.name),
        slug: req.body?.slug === undefined ? undefined : trimOrUndefined(req.body?.slug) ?? undefined,
        description: req.body?.description === undefined ? undefined : trimOrUndefined(req.body?.description) ?? null,
        status: req.body?.status === undefined ? undefined : normalizeStatus(req.body?.status),
        monthlyCompletedTurnLimit: parseOptionalNonNegativeInteger(req.body?.monthlyCompletedTurnLimit, "每月 AI Request"),
        monthlyTokenLimit: parseOptionalNonNegativeInteger(req.body?.monthlyTokenLimit, "每月服务额度")
      });
      const relatedGrants = await getGrants().list({ planId: plan.id });
      res.json({
        plan: {
          ...plan,
          assignmentCount: {
            users: relatedGrants.filter((item) => item.principalType === "user").length,
            organizations: relatedGrants.filter((item) => item.principalType === "organization").length
          }
        }
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "更新套餐失败";
      res.status(400).json({ detail });
    }
  });

  router.get("/subscriptions/users", async (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const service = getService();
      const [users, grants, plans] = await Promise.all([
        db.user.findMany({
          orderBy: [{ updatedAt: "desc" }],
          include: {
            primaryOrganization: {
              select: { id: true, name: true, slug: true, type: true, status: true }
            },
            organizationMemberships: {
              where: { status: "active" },
              select: {
                organization: {
                  select: { id: true, name: true, slug: true, type: true, status: true }
                }
              }
            }
          }
        }),
        getGrants().list(),
        getPlans().list()
      ]);

      const now = new Date();
      const planMap = new Map(plans.map((plan) => [plan.id, plan]));
      const grantMap = new Map(grants.map((grant) => [`${grant.principalType}:${grant.principalId}`, grant]));
      const organizationGrantEvaluations = new Map<string, Awaited<ReturnType<SubscriptionEntitlementService["evaluateGrant"]>>>();
      const userGrantEvaluations = new Map<string, Awaited<ReturnType<SubscriptionEntitlementService["evaluateGrant"]>>>();

      await Promise.all(
        grants.map(async (grant) => {
          const plan = grant.planId ? planMap.get(grant.planId) ?? null : null;
          const evaluation = await service.evaluateGrant({
            principalType: grant.principalType,
            principalId: grant.principalId,
            grant,
            plan,
            now
          });
          if (grant.principalType === "organization") {
            organizationGrantEvaluations.set(grant.principalId, evaluation);
          } else {
            userGrantEvaluations.set(grant.principalId, evaluation);
          }
        })
      );

      const records = users.map((user) => {
        const organization = pickUserOrganization(user);
        const userGrant = grantMap.get(`user:${user.id}`) ?? null;
        const organizationGrant = organization ? grantMap.get(`organization:${organization.id}`) ?? null : null;
        const userEvaluation = userGrant ? userGrantEvaluations.get(user.id) ?? null : null;
        const organizationEvaluation =
          organization && organizationGrant ? organizationGrantEvaluations.get(organization.id) ?? null : null;

        let source;
        let access;
        if (userEvaluation) {
          source = {
            mode: "user",
            label: "单独设置",
            planName: userEvaluation.plan?.name ?? null
          };
          access = {
            status: userEvaluation.access.status === "available" ? "available" : userEvaluation.access.status,
            title: userEvaluation.access.title,
            description: userEvaluation.access.description
          };
        } else if (organizationEvaluation) {
          source = {
            mode: "organization",
            label: "跟随组织",
            planName: organizationEvaluation.plan?.name ?? null
          };
          access = {
            status: organizationEvaluation.access.status === "available" ? "available" : organizationEvaluation.access.status,
            title: organizationEvaluation.access.title,
            description: organizationEvaluation.access.description
          };
        } else {
          source = sourceFromDefault(organization?.type);
          access = accessFromDefault(organization?.type);
        }

        return {
          id: user.id,
          displayName: trimOrUndefined(user.displayName) ?? null,
          email: trimOrUndefined(user.email) ?? null,
          userType: trimOrUndefined(user.userType) ?? "external_user",
          organization,
          source,
          access,
          userGrant: userEvaluation ? mapGrantSummary(userEvaluation) : null,
          organizationGrant: organizationEvaluation ? mapGrantSummary(organizationEvaluation) : null
        };
      });

      res.json({
        summary: {
          totalUsers: records.length,
          explicitUserSubscriptions: records.filter((item) => item.userGrant).length,
          coveredByOrganization: records.filter((item) => !item.userGrant && item.organizationGrant).length,
          internalDefaultUnlimited: records.filter(
            (item) => !item.userGrant && !item.organizationGrant && item.organization?.type === "internal"
          ).length,
          externalRestrictedByDefault: records.filter(
            (item) => !item.userGrant && !item.organizationGrant && item.organization?.type !== "internal"
          ).length,
          blockedUsers: records.filter((item) => item.access.status !== "available").length,
          expiringSoon: records.filter((item) => isExpiringSoon(item.userGrant?.expiresAt, now)).length
        },
        users: records
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "加载用户订阅失败";
      res.status(500).json({ detail });
    }
  });

  router.put("/subscriptions/users/:userId/grant", async (req: Request, res: Response) => {
    try {
      const userId = trimOrUndefined(req.params.userId);
      if (!userId) {
        res.status(400).json({ detail: "userId is required" });
        return;
      }
      const startsAt = parseRequiredDate(req.body?.startsAt, "开始时间");
      const expiresAt = parseOptionalDate(req.body?.expiresAt);
      const cycleAnchorAt = parseOptionalDate(req.body?.cycleAnchorAt) ?? startsAt;
      const grant = await getGrants().upsertForPrincipal({
        principalType: "user",
        principalId: userId,
        planId: trimOrUndefined(req.body?.planId) ?? null,
        status: normalizeStatus(req.body?.status) ?? "active",
        startsAt,
        expiresAt: expiresAt ?? null,
        cycleAnchorAt,
        completedTurnLimitOverride: parseOptionalNonNegativeInteger(req.body?.completedTurnLimitOverride, "AI Request"),
        tokenLimitOverride: parseOptionalNonNegativeInteger(req.body?.tokenLimitOverride, "服务额度"),
        note: trimOrUndefined(req.body?.note) ?? null,
        createdByUserId: req.currentUser?.id ?? null
      });
      const evaluation = await getService().evaluateGrant({
        principalType: "user",
        principalId: grant.principalId,
        grant,
        now: new Date()
      });
      res.json({ grant: mapGrantSummary(evaluation) });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "保存用户订阅失败";
      res.status(400).json({ detail });
    }
  });

  router.delete("/subscriptions/users/:userId/grant", async (req: Request, res: Response) => {
    try {
      await getGrants().deleteByPrincipal("user", req.params.userId);
      res.json({ ok: true });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "移除用户订阅失败";
      res.status(400).json({ detail });
    }
  });

  router.get("/subscriptions/organizations", async (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const service = getService();
      const [organizations, grants, plans] = await Promise.all([
        db.organization.findMany({
          orderBy: [{ type: "asc" }, { name: "asc" }],
          include: {
            _count: {
              select: {
                memberships: true
              }
            }
          }
        }),
        getGrants().list({ principalType: "organization" }),
        getPlans().list()
      ]);

      const now = new Date();
      const planMap = new Map(plans.map((plan) => [plan.id, plan]));
      const grantMap = new Map(grants.map((grant) => [grant.principalId, grant]));
      const evaluations = new Map<string, Awaited<ReturnType<SubscriptionEntitlementService["evaluateGrant"]>>>();

      await Promise.all(
        grants.map(async (grant) => {
          const evaluation = await service.evaluateGrant({
            principalType: "organization",
            principalId: grant.principalId,
            grant,
            plan: grant.planId ? planMap.get(grant.planId) ?? null : null,
            now
          });
          evaluations.set(grant.principalId, evaluation);
        })
      );

      const records = organizations.map((organization) => {
        const evaluation = evaluations.get(organization.id) ?? null;
        return {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          type: organization.type,
          status: organization.status,
          memberCount: organization._count.memberships,
          source: evaluation
            ? {
                mode: "organization",
                label: "组织已设置",
                planName: evaluation.plan?.name ?? null
              }
            : sourceFromDefault(organization.type),
          access: evaluation
            ? {
                status: evaluation.access.status,
                title: evaluation.access.title,
                description: evaluation.access.description
              }
            : accessFromDefault(organization.type),
          grant: evaluation ? mapGrantSummary(evaluation) : null
        };
      });

      res.json({
        summary: {
          totalOrganizations: records.length,
          explicitOrganizationSubscriptions: records.filter((item) => item.grant).length,
          internalDefaultUnlimited: records.filter((item) => !item.grant && item.type === "internal").length,
          externalNeedSubscription: records.filter((item) => !item.grant && item.type !== "internal").length,
          blockedOrganizations: records.filter((item) => item.access.status !== "available").length,
          expiringSoon: records.filter((item) => isExpiringSoon(item.grant?.expiresAt, now)).length
        },
        organizations: records
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "加载组织订阅失败";
      res.status(500).json({ detail });
    }
  });

  router.put("/subscriptions/organizations/:organizationId/grant", async (req: Request, res: Response) => {
    try {
      const organizationId = trimOrUndefined(req.params.organizationId);
      if (!organizationId) {
        res.status(400).json({ detail: "organizationId is required" });
        return;
      }
      const startsAt = parseRequiredDate(req.body?.startsAt, "开始时间");
      const expiresAt = parseOptionalDate(req.body?.expiresAt);
      const cycleAnchorAt = parseOptionalDate(req.body?.cycleAnchorAt) ?? startsAt;
      const grant = await getGrants().upsertForPrincipal({
        principalType: "organization",
        principalId: organizationId,
        planId: trimOrUndefined(req.body?.planId) ?? null,
        status: normalizeStatus(req.body?.status) ?? "active",
        startsAt,
        expiresAt: expiresAt ?? null,
        cycleAnchorAt,
        completedTurnLimitOverride: parseOptionalNonNegativeInteger(req.body?.completedTurnLimitOverride, "AI Request"),
        tokenLimitOverride: parseOptionalNonNegativeInteger(req.body?.tokenLimitOverride, "服务额度"),
        note: trimOrUndefined(req.body?.note) ?? null,
        createdByUserId: req.currentUser?.id ?? null
      });
      const evaluation = await getService().evaluateGrant({
        principalType: "organization",
        principalId: grant.principalId,
        grant,
        now: new Date()
      });
      res.json({ grant: mapGrantSummary(evaluation) });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "保存组织订阅失败";
      res.status(400).json({ detail });
    }
  });

  router.delete("/subscriptions/organizations/:organizationId/grant", async (req: Request, res: Response) => {
    try {
      await getGrants().deleteByPrincipal("organization", req.params.organizationId);
      res.json({ ok: true });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "移除组织订阅失败";
      res.status(400).json({ detail });
    }
  });

  router.get("/subscriptions/denials", async (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const events = await getDenialLogs().list({ take: 120 });
      const userIds = [...new Set(events.map((item) => item.userId).filter(Boolean) as string[])];
      const organizationIds = [...new Set(events.map((item) => item.organizationId).filter(Boolean) as string[])];
      const [users, organizations] = await Promise.all([
        userIds.length
          ? db.user.findMany({
              where: { id: { in: userIds } },
              select: { id: true, displayName: true, email: true }
            })
          : Promise.resolve([]),
        organizationIds.length
          ? db.organization.findMany({
              where: { id: { in: organizationIds } },
              select: { id: true, name: true, slug: true, type: true }
            })
          : Promise.resolve([])
      ]);
      const userMap = new Map(users.map((user) => [user.id, user]));
      const organizationMap = new Map(organizations.map((organization) => [organization.id, organization]));

      res.json({
        events: events.map((event) => ({
          id: event.id,
          reasonCode: event.reasonCode,
          title: event.title,
          detail: event.detail ?? null,
          model: event.model ?? null,
          threadId: event.threadId ?? null,
          sessionId: event.sessionId ?? null,
          createdAt: event.createdAt,
          user: event.userId
            ? {
                id: event.userId,
                displayName: trimOrUndefined(userMap.get(event.userId)?.displayName) ?? null,
                email: trimOrUndefined(userMap.get(event.userId)?.email) ?? null
              }
            : null,
          organization: event.organizationId
            ? {
                id: event.organizationId,
                name: organizationMap.get(event.organizationId)?.name ?? event.organizationId,
                slug: organizationMap.get(event.organizationId)?.slug ?? null,
                type: organizationMap.get(event.organizationId)?.type ?? null
              }
            : null
        }))
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "加载阻断记录失败";
      res.status(500).json({ detail });
    }
  });

  return router;
}
