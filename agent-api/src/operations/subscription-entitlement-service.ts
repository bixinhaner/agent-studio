import { isInternalOrganizationType } from "../auth/resource-role-context.js";
import type { UsageEventRepository } from "../persistence/usage-event-repository.js";
import type {
  SubscriptionDenialLogRepository
} from "../persistence/subscription-denial-log-repository.js";
import type {
  SubscriptionGrantRecord,
  SubscriptionGrantRepository,
  SubscriptionPrincipalType
} from "../persistence/subscription-grant-repository.js";
import type { SubscriptionPlanRecord, SubscriptionPlanRepository } from "../persistence/subscription-plan-repository.js";

type PrincipalLabel = "当前账号" | "所属组织";

type CurrentActor = {
  id: string;
  organizationId: string;
  organizationType?: string;
};

export type SubscriptionGrantUsage = {
  cycleStartsAt: string;
  cycleEndsAt: string;
  usedCompletedTurns: number;
  usedTokens: number;
  remainingCompletedTurns: number | null;
  remainingTokens: number | null;
};

export type SubscriptionGrantEvaluation = {
  grant: SubscriptionGrantRecord;
  plan: SubscriptionPlanRecord | null;
  limits: {
    monthlyCompletedTurnLimit: number | null;
    monthlyTokenLimit: number | null;
  };
  usage: SubscriptionGrantUsage | null;
  access: {
    status: "available" | "paused" | "scheduled" | "expired" | "exhausted";
    reasonCode: string | null;
    title: string;
    description: string;
  };
};

export type ChatAccessDecision = {
  allowed: boolean;
  reasonCode: string | null;
  message: string;
  userGrant: SubscriptionGrantEvaluation | null;
  organizationGrant: SubscriptionGrantEvaluation | null;
  defaultPolicy: "internal_unlimited" | "external_requires_subscription" | null;
};

export class ChatAccessDeniedError extends Error {
  readonly statusCode = 403;

  constructor(message: string) {
    super(message);
    this.name = "ChatAccessDeniedError";
  }
}

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toDate(value: string | Date): Date {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function toIsoString(value: Date): string {
  return value.toISOString();
}

function daysInUtcMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function addUtcMonthsClamped(anchor: Date, monthOffset: number): Date {
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth() + monthOffset;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const targetDay = Math.min(anchor.getUTCDate(), daysInUtcMonth(targetYear, targetMonth));
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      targetDay,
      anchor.getUTCHours(),
      anchor.getUTCMinutes(),
      anchor.getUTCSeconds(),
      anchor.getUTCMilliseconds()
    )
  );
}

function resolveCycleBounds(anchor: Date, now: Date): { cycleStartsAt: Date; cycleEndsAt: Date } {
  if (now <= anchor) {
    return {
      cycleStartsAt: anchor,
      cycleEndsAt: addUtcMonthsClamped(anchor, 1)
    };
  }

  let monthOffset = (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (now.getUTCMonth() - anchor.getUTCMonth());
  let cycleStartsAt = addUtcMonthsClamped(anchor, monthOffset);
  if (cycleStartsAt > now) {
    monthOffset -= 1;
    cycleStartsAt = addUtcMonthsClamped(anchor, monthOffset);
  }

  let cycleEndsAt = addUtcMonthsClamped(anchor, monthOffset + 1);
  while (cycleEndsAt <= now) {
    monthOffset += 1;
    cycleStartsAt = addUtcMonthsClamped(anchor, monthOffset);
    cycleEndsAt = addUtcMonthsClamped(anchor, monthOffset + 1);
  }

  return { cycleStartsAt, cycleEndsAt };
}

function effectiveLimits(grant: SubscriptionGrantRecord, plan: SubscriptionPlanRecord | null) {
  return {
    monthlyCompletedTurnLimit: grant.completedTurnLimitOverride ?? plan?.monthlyCompletedTurnLimit ?? null,
    monthlyTokenLimit: grant.tokenLimitOverride ?? plan?.monthlyTokenLimit ?? null
  };
}

function makeGrantCopy(
  principalType: SubscriptionPrincipalType,
  status: SubscriptionGrantEvaluation["access"]["status"],
  reasonCode: string | null
): { title: string; description: string } {
  const subject: PrincipalLabel = principalType === "user" ? "当前账号" : "所属组织";
  switch (status) {
    case "paused":
      return {
        title: "已暂停",
        description: `${subject}的可用期已暂停，请联系管理员恢复后再继续提问。`
      };
    case "scheduled":
      return {
        title: "待生效",
        description: `${subject}的可用期尚未开始，请在生效后再试。`
      };
    case "expired":
      return {
        title: "已到期",
        description: `${subject}的可用期已结束，请联系管理员续期后再继续提问。`
      };
    case "exhausted":
      if (reasonCode?.includes("token_limit")) {
        return {
          title: "额度用尽",
          description: `${subject}本周期的服务额度已用完，请等待下个周期或联系管理员调整。`
        };
      }
      return {
        title: "额度用尽",
        description: `${subject}本周期的问答次数已用完，请等待下个周期或联系管理员调整。`
      };
    case "available":
    default:
      return {
        title: "可用",
        description: `${subject}当前仍可继续发起新问题。`
      };
  }
}

function defaultDecision(organizationType: string | null | undefined): ChatAccessDecision {
  if (isInternalOrganizationType(organizationType)) {
    return {
      allowed: true,
      reasonCode: null,
      message: "内部组织未单独配置时默认不限制使用。",
      userGrant: null,
      organizationGrant: null,
      defaultPolicy: "internal_unlimited"
    };
  }

  return {
    allowed: false,
    reasonCode: "external_subscription_required",
    message: "当前账号尚未开通可用套餐，请联系管理员开通后再继续提问。",
    userGrant: null,
    organizationGrant: null,
    defaultPolicy: "external_requires_subscription"
  };
}

export function isChatAccessDeniedError(error: unknown): error is ChatAccessDeniedError {
  return error instanceof ChatAccessDeniedError;
}

export class SubscriptionEntitlementService {
  constructor(
    private readonly dependencies: {
      grants: Pick<SubscriptionGrantRepository, "getByPrincipal">;
      plans: Pick<SubscriptionPlanRepository, "getById">;
      usageEvents: Pick<UsageEventRepository, "listByExactCreatedAtRange">;
      denialLogs?: Pick<SubscriptionDenialLogRepository, "create">;
    }
  ) {}

  async evaluateGrant(input: {
    principalType: SubscriptionPrincipalType;
    principalId: string;
    grant: SubscriptionGrantRecord;
    plan?: SubscriptionPlanRecord | null;
    now?: Date;
  }): Promise<SubscriptionGrantEvaluation> {
    const now = input.now ?? new Date();
    const plan = input.plan === undefined ? await this.dependencies.plans.getById(input.grant.planId ?? "") : input.plan;
    const limits = effectiveLimits(input.grant, plan);

    if (trimOrUndefined(input.grant.status) !== "active") {
      const copy = makeGrantCopy(input.principalType, "paused", "subscription_paused");
      return {
        grant: input.grant,
        plan,
        limits,
        usage: null,
        access: {
          status: "paused",
          reasonCode: `${input.principalType}_subscription_paused`,
          title: copy.title,
          description: copy.description
        }
      };
    }

    const startsAt = toDate(input.grant.startsAt);
    if (startsAt > now) {
      const copy = makeGrantCopy(input.principalType, "scheduled", "subscription_not_started");
      return {
        grant: input.grant,
        plan,
        limits,
        usage: null,
        access: {
          status: "scheduled",
          reasonCode: `${input.principalType}_subscription_not_started`,
          title: copy.title,
          description: copy.description
        }
      };
    }

    const expiresAt = input.grant.expiresAt ? toDate(input.grant.expiresAt) : null;
    if (expiresAt && expiresAt <= now) {
      const copy = makeGrantCopy(input.principalType, "expired", "subscription_expired");
      return {
        grant: input.grant,
        plan,
        limits,
        usage: null,
        access: {
          status: "expired",
          reasonCode: `${input.principalType}_subscription_expired`,
          title: copy.title,
          description: copy.description
        }
      };
    }

    const { cycleStartsAt, cycleEndsAt } = resolveCycleBounds(toDate(input.grant.cycleAnchorAt), now);
    const usageEvents = await this.dependencies.usageEvents.listByExactCreatedAtRange({
      ...(input.principalType === "organization"
        ? { organizationId: input.principalId }
        : { userId: input.principalId }),
      featureType: "chat",
      resultStatus: "success",
      from: cycleStartsAt,
      to: cycleEndsAt
    });
    const usedCompletedTurns = usageEvents.length;
    const usedTokens = usageEvents.reduce(
      (sum, item) => sum + item.inputTokens + item.cachedInputTokens + item.outputTokens,
      0
    );

    const usage: SubscriptionGrantUsage = {
      cycleStartsAt: toIsoString(cycleStartsAt),
      cycleEndsAt: toIsoString(cycleEndsAt),
      usedCompletedTurns,
      usedTokens,
      remainingCompletedTurns:
        limits.monthlyCompletedTurnLimit === null
          ? null
          : Math.max(limits.monthlyCompletedTurnLimit - usedCompletedTurns, 0),
      remainingTokens: limits.monthlyTokenLimit === null ? null : Math.max(limits.monthlyTokenLimit - usedTokens, 0)
    };

    if (limits.monthlyCompletedTurnLimit !== null && usedCompletedTurns >= limits.monthlyCompletedTurnLimit) {
      const copy = makeGrantCopy(input.principalType, "exhausted", "turn_limit_exceeded");
      return {
        grant: input.grant,
        plan,
        limits,
        usage,
        access: {
          status: "exhausted",
          reasonCode: `${input.principalType}_turn_limit_exceeded`,
          title: copy.title,
          description: copy.description
        }
      };
    }

    if (limits.monthlyTokenLimit !== null && usedTokens >= limits.monthlyTokenLimit) {
      const copy = makeGrantCopy(input.principalType, "exhausted", "token_limit_exceeded");
      return {
        grant: input.grant,
        plan,
        limits,
        usage,
        access: {
          status: "exhausted",
          reasonCode: `${input.principalType}_token_limit_exceeded`,
          title: copy.title,
          description: copy.description
        }
      };
    }

    const copy = makeGrantCopy(input.principalType, "available", null);
    return {
      grant: input.grant,
      plan,
      limits,
      usage,
      access: {
        status: "available",
        reasonCode: null,
        title: copy.title,
        description: copy.description
      }
    };
  }

  async evaluateAccessForChat(input: {
    currentUser: CurrentActor;
    model: string;
    now?: Date;
  }): Promise<ChatAccessDecision> {
    const now = input.now ?? new Date();
    const [userGrant, organizationGrant] = await Promise.all([
      this.dependencies.grants.getByPrincipal("user", input.currentUser.id),
      this.dependencies.grants.getByPrincipal("organization", input.currentUser.organizationId)
    ]);

    if (!userGrant && !organizationGrant) {
      return defaultDecision(input.currentUser.organizationType);
    }

    const [userEvaluation, organizationEvaluation] = await Promise.all([
      userGrant
        ? this.evaluateGrant({
            principalType: "user",
            principalId: input.currentUser.id,
            grant: userGrant,
            now
          })
        : Promise.resolve(null),
      organizationGrant
        ? this.evaluateGrant({
            principalType: "organization",
            principalId: input.currentUser.organizationId,
            grant: organizationGrant,
            now
          })
        : Promise.resolve(null)
    ]);

    if (organizationEvaluation && organizationEvaluation.access.status !== "available") {
      return {
        allowed: false,
        reasonCode: organizationEvaluation.access.reasonCode,
        message: organizationEvaluation.access.description,
        userGrant: userEvaluation,
        organizationGrant: organizationEvaluation,
        defaultPolicy: null
      };
    }

    if (userEvaluation && userEvaluation.access.status !== "available") {
      return {
        allowed: false,
        reasonCode: userEvaluation.access.reasonCode,
        message: userEvaluation.access.description,
        userGrant: userEvaluation,
        organizationGrant: organizationEvaluation,
        defaultPolicy: null
      };
    }

    return {
      allowed: true,
      reasonCode: null,
      message: "套餐可用。",
      userGrant: userEvaluation,
      organizationGrant: organizationEvaluation,
      defaultPolicy: null
    };
  }

  async enforceChatAccess(input: {
    currentUser: CurrentActor;
    model: string;
    threadId?: string;
    sessionId?: string;
    now?: Date;
  }): Promise<void> {
    const decision = await this.evaluateAccessForChat(input);
    if (decision.allowed) return;

    const failingEvaluation = decision.organizationGrant?.access.status !== "available"
      ? decision.organizationGrant
      : decision.userGrant?.access.status !== "available"
        ? decision.userGrant
        : null;

    if (this.dependencies.denialLogs) {
      await this.dependencies.denialLogs.create({
        organizationId: input.currentUser.organizationId,
        userId: input.currentUser.id,
        threadId: trimOrUndefined(input.threadId) ?? null,
        sessionId: trimOrUndefined(input.sessionId) ?? null,
        principalType: failingEvaluation?.grant.principalType ?? "organization",
        principalId:
          failingEvaluation?.grant.principalId ??
          (decision.defaultPolicy === "external_requires_subscription" ? input.currentUser.organizationId : input.currentUser.id),
        reasonCode: decision.reasonCode ?? "subscription_denied",
        title: failingEvaluation?.access.title ?? "未开通",
        detail: decision.message,
        model: input.model,
        metadata: {
          defaultPolicy: decision.defaultPolicy,
          userGrantId: decision.userGrant?.grant.id ?? null,
          organizationGrantId: decision.organizationGrant?.grant.id ?? null
        }
      });
    }

    throw new ChatAccessDeniedError(decision.message);
  }
}
