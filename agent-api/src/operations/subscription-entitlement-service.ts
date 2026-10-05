import { isInternalPortalActor } from "../auth/portal-audience.js";
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
import { usageTotalTokens } from "./usage-metrics.js";

type PrincipalLabel = "Your account" | "Your workspace";

type CurrentActor = {
  id: string;
  organizationId: string;
  organizationType?: string;
  membershipType?: string;
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

export type PortalSubscriptionStatus = {
  accessState: "available" | "blocked";
  tone: "positive" | "caution" | "critical" | "neutral";
  sourceType: "user" | "organization" | "default_internal" | "default_external";
  sourceLabel: string;
  title: string;
  summary: string;
  detail: string;
  actionLabel: string | null;
  planName: string | null;
  expiresAt: string | null;
  cycleEndsAt: string | null;
  remainingCompletedTurns: number | null;
  completedTurnLimit: number | null;
  reasonCode: string | null;
};

export class ChatAccessDeniedError extends Error {
  readonly statusCode = 403;
  readonly code: string;
  readonly reasonCode: string | null;

  constructor(message: string, reasonCode?: string | null, code?: string) {
    super(message);
    this.name = "ChatAccessDeniedError";
    this.reasonCode = reasonCode ?? null;
    this.code = code || accessDeniedCodeForReason(reasonCode);
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
  const subject: PrincipalLabel = principalType === "user" ? "Your account" : "Your workspace";
  switch (status) {
    case "paused":
      return {
        title: "Access is paused",
        description: `${subject} access is paused. Ask your admin to resume access before sending a new AI request.`
      };
    case "scheduled":
      return {
        title: "Access starts soon",
        description: `${subject} access has not started yet. Try again after the start time.`
      };
    case "expired":
      return {
        title: "Access has ended",
        description: `${subject} access has ended. Ask your admin to renew access before sending a new AI request.`
      };
    case "exhausted":
      if (reasonCode?.includes("token_limit")) {
        return {
          title: "Service capacity reached",
          description: `${subject} service capacity has been used for this cycle. Wait for the next cycle or ask your admin to adjust the plan.`
        };
      }
      return {
        title: "AI request limit reached",
        description: `${subject} AI requests have been used for this cycle. Wait for the next cycle or ask your admin to adjust the plan.`
      };
    case "available":
    default:
      return {
        title: "Access is active",
        description: `${subject} can send new AI requests.`
      };
  }
}

function defaultDecision(actor: Pick<CurrentActor, "organizationType" | "membershipType">): ChatAccessDecision {
  if (isInternalPortalActor(actor)) {
    return {
      allowed: true,
      reasonCode: null,
      message: "Internal workspaces are unrestricted unless a separate plan is configured.",
      userGrant: null,
      organizationGrant: null,
      defaultPolicy: "internal_unlimited"
    };
  }

  return {
    allowed: false,
    reasonCode: "external_subscription_required",
    message: "Your workspace has not enabled access yet. Ask your admin to assign a plan before sending a new AI request.",
    userGrant: null,
    organizationGrant: null,
    defaultPolicy: "external_requires_subscription"
  };
}

function daysUntil(from: Date, to: Date): number {
  const diffMs = to.getTime() - from.getTime();
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}

function formatAiRequestCount(value: number): string {
  return value === 1 ? "1 AI request" : `${value} AI requests`;
}

function accessDeniedCodeForReason(reasonCode: string | null | undefined): string {
  const normalized = (reasonCode || "").trim().toLowerCase();
  if (normalized.includes("turn_limit_exceeded")) return "AI_REQUEST_LIMIT_REACHED";
  if (normalized.includes("token_limit_exceeded")) return "AI_TOKEN_LIMIT_REACHED";
  if (normalized.includes("subscription_required")) return "SUBSCRIPTION_REQUIRED";
  if (normalized.includes("subscription_expired")) return "SUBSCRIPTION_EXPIRED";
  if (normalized.includes("subscription_paused")) return "SUBSCRIPTION_PAUSED";
  if (normalized.includes("subscription_not_started")) return "SUBSCRIPTION_NOT_STARTED";
  return "CHAT_ACCESS_DENIED";
}

function selectPortalEvaluation(input: {
  userGrant: SubscriptionGrantEvaluation | null;
  organizationGrant: SubscriptionGrantEvaluation | null;
}): SubscriptionGrantEvaluation | null {
  const organizationBlocked = input.organizationGrant && input.organizationGrant.access.status !== "available"
    ? input.organizationGrant
    : null;
  if (organizationBlocked) return organizationBlocked;

  const userBlocked = input.userGrant && input.userGrant.access.status !== "available"
    ? input.userGrant
    : null;
  if (userBlocked) return userBlocked;

  if (input.userGrant && input.organizationGrant) {
    const userRemaining = input.userGrant.usage?.remainingCompletedTurns;
    const organizationRemaining = input.organizationGrant.usage?.remainingCompletedTurns;

    if (userRemaining !== null && userRemaining !== undefined && organizationRemaining !== null && organizationRemaining !== undefined) {
      return userRemaining <= organizationRemaining ? input.userGrant : input.organizationGrant;
    }
    if (userRemaining !== null && userRemaining !== undefined) return input.userGrant;
    if (organizationRemaining !== null && organizationRemaining !== undefined) return input.organizationGrant;

    const userExpiresAt = input.userGrant.grant.expiresAt ? toDate(input.userGrant.grant.expiresAt) : null;
    const organizationExpiresAt = input.organizationGrant.grant.expiresAt ? toDate(input.organizationGrant.grant.expiresAt) : null;
    if (userExpiresAt && organizationExpiresAt) {
      return userExpiresAt <= organizationExpiresAt ? input.userGrant : input.organizationGrant;
    }
    if (userExpiresAt) return input.userGrant;
    if (organizationExpiresAt) return input.organizationGrant;
    return input.userGrant;
  }

  return input.userGrant ?? input.organizationGrant ?? null;
}

function sourceLabelForPortalStatus(input: {
  evaluation: SubscriptionGrantEvaluation | null;
  defaultPolicy: ChatAccessDecision["defaultPolicy"];
  blocked: boolean;
}): Pick<PortalSubscriptionStatus, "sourceType" | "sourceLabel"> {
  if (input.evaluation?.grant.principalType === "user") {
    return {
      sourceType: "user",
      sourceLabel: input.blocked ? "Blocked by your personal plan" : "Managed through your personal plan"
    };
  }
  if (input.evaluation?.grant.principalType === "organization") {
    return {
      sourceType: "organization",
      sourceLabel: input.blocked ? "Blocked by your workspace plan" : "Managed through your workspace plan"
    };
  }
  if (input.defaultPolicy === "internal_unlimited") {
    return {
      sourceType: "default_internal",
      sourceLabel: "Included by your internal workspace"
    };
  }
  return {
    sourceType: "default_external",
    sourceLabel: "A workspace plan is required"
  };
}

function buildPortalStatus(input: {
  decision: ChatAccessDecision;
  now: Date;
}): PortalSubscriptionStatus {
  const evaluation = selectPortalEvaluation({
    userGrant: input.decision.userGrant,
    organizationGrant: input.decision.organizationGrant
  });
  const source = sourceLabelForPortalStatus({
    evaluation,
    defaultPolicy: input.decision.defaultPolicy,
    blocked: !input.decision.allowed
  });
  const expiresAt = evaluation?.grant.expiresAt ?? null;
  const cycleEndsAt = evaluation?.usage?.cycleEndsAt ?? null;
  const remainingCompletedTurns = evaluation?.usage?.remainingCompletedTurns ?? null;
  const completedTurnLimit = evaluation?.limits.monthlyCompletedTurnLimit ?? null;
  const planName = evaluation?.plan?.name ?? null;
  const reasonCode = input.decision.reasonCode ?? evaluation?.access.reasonCode ?? null;

  if (input.decision.defaultPolicy === "internal_unlimited" && !evaluation) {
    return {
      accessState: "available",
      tone: "neutral",
      sourceType: source.sourceType,
      sourceLabel: source.sourceLabel,
      title: "Access is available",
      summary: "Your internal workspace is not currently using a separate subscription limit.",
      detail: "You can keep sending AI requests without setting up a personal plan.",
      actionLabel: null,
      planName: null,
      expiresAt: null,
      cycleEndsAt: null,
      remainingCompletedTurns: null,
      completedTurnLimit: null,
      reasonCode: null
    };
  }

  if (input.decision.defaultPolicy === "external_requires_subscription" && !evaluation) {
    return {
      accessState: "blocked",
      tone: "critical",
      sourceType: source.sourceType,
      sourceLabel: source.sourceLabel,
      title: "A plan is required",
      summary: "Your workspace has not enabled access yet.",
      detail: "Ask your workspace admin to assign a plan before you send an AI request.",
      actionLabel: "Contact your workspace admin to enable access.",
      planName: null,
      expiresAt: null,
      cycleEndsAt: null,
      remainingCompletedTurns: null,
      completedTurnLimit: null,
      reasonCode
    };
  }

  if (!evaluation) {
    return {
      accessState: input.decision.allowed ? "available" : "blocked",
      tone: input.decision.allowed ? "neutral" : "critical",
      sourceType: source.sourceType,
      sourceLabel: source.sourceLabel,
      title: input.decision.allowed ? "Access is available" : "Access is unavailable",
      summary: input.decision.allowed ? "You can send a new AI request." : "You cannot send a new AI request right now.",
      detail: input.decision.message,
      actionLabel: input.decision.allowed ? null : "Please contact your workspace admin for help.",
      planName: null,
      expiresAt: null,
      cycleEndsAt: null,
      remainingCompletedTurns: null,
      completedTurnLimit: null,
      reasonCode
    };
  }

  if (!input.decision.allowed) {
    if (reasonCode?.includes("subscription_paused")) {
      return {
        accessState: "blocked",
        tone: "caution",
        sourceType: source.sourceType,
        sourceLabel: source.sourceLabel,
        title: "Access is paused",
        summary: "This plan is currently paused for new AI requests.",
        detail: "You can keep reading earlier chats, but you will need your admin to resume access before sending a new AI request.",
        actionLabel: "Ask your workspace admin to resume this plan.",
        planName,
        expiresAt,
        cycleEndsAt,
        remainingCompletedTurns,
        completedTurnLimit,
        reasonCode
      };
    }
    if (reasonCode?.includes("subscription_not_started")) {
      return {
        accessState: "blocked",
        tone: "caution",
        sourceType: source.sourceType,
        sourceLabel: source.sourceLabel,
        title: "Access starts soon",
        summary: "Your plan has been scheduled, but it is not active yet.",
        detail: "You can send AI requests as soon as the plan begins.",
        actionLabel: "If this start date looks wrong, contact your workspace admin.",
        planName,
        expiresAt,
        cycleEndsAt,
        remainingCompletedTurns,
        completedTurnLimit,
        reasonCode
      };
    }
    if (reasonCode?.includes("subscription_expired")) {
      return {
        accessState: "blocked",
        tone: "critical",
        sourceType: source.sourceType,
        sourceLabel: source.sourceLabel,
        title: "Your access has ended",
        summary: "This plan is no longer active for new AI requests.",
        detail: "Ask your workspace admin to renew access, then try again.",
        actionLabel: "Contact your workspace admin for a renewal.",
        planName,
        expiresAt,
        cycleEndsAt,
        remainingCompletedTurns,
        completedTurnLimit,
        reasonCode
      };
    }
    if (reasonCode?.includes("token_limit_exceeded")) {
      return {
        accessState: "blocked",
        tone: "critical",
        sourceType: source.sourceType,
        sourceLabel: source.sourceLabel,
        title: "This workspace is temporarily unavailable",
        summary: "This plan has reached its service capacity for the current cycle.",
        detail: "You can keep reading earlier chats. To send a new AI request, wait for the next reset or ask your admin for more capacity.",
        actionLabel: "Try again after the next cycle reset or contact your workspace admin.",
        planName,
        expiresAt,
        cycleEndsAt,
        remainingCompletedTurns,
        completedTurnLimit,
        reasonCode
      };
    }
    return {
      accessState: "blocked",
      tone: "critical",
      sourceType: source.sourceType,
      sourceLabel: source.sourceLabel,
      title: "AI request limit reached",
      summary: "You have used all AI requests included in this cycle.",
      detail: "You can keep reading earlier chats. To send a new AI request, wait for the next reset or ask your admin to adjust the plan.",
      actionLabel: "Try again after the next cycle reset or contact your workspace admin.",
      planName,
      expiresAt,
      cycleEndsAt,
      remainingCompletedTurns,
      completedTurnLimit,
      reasonCode
    };
  }

  const expiresSoon = expiresAt ? daysUntil(input.now, toDate(expiresAt)) <= 7 : false;
  if (remainingCompletedTurns !== null && remainingCompletedTurns !== undefined) {
    return {
      accessState: "available",
      tone: remainingCompletedTurns <= 3 || expiresSoon ? "caution" : "positive",
      sourceType: source.sourceType,
      sourceLabel: source.sourceLabel,
      title: expiresSoon ? "Access ends soon" : "Access is active",
      summary: `${formatAiRequestCount(remainingCompletedTurns)} left in this cycle.`,
      detail: expiresSoon
        ? "Your plan is active, but it is approaching its end date."
        : "You can keep sending AI requests within the current cycle.",
      actionLabel: expiresSoon ? "If you need uninterrupted access, contact your workspace admin before it ends." : null,
      planName,
      expiresAt,
      cycleEndsAt,
      remainingCompletedTurns,
      completedTurnLimit,
      reasonCode: null
    };
  }

  return {
    accessState: "available",
    tone: expiresSoon ? "caution" : "positive",
    sourceType: source.sourceType,
    sourceLabel: source.sourceLabel,
    title: expiresSoon ? "Access ends soon" : "Access is active",
    summary: "Your plan is active for AI requests.",
    detail: expiresSoon
      ? "Your plan is active, but it is approaching its end date."
      : "No AI request limit is currently shown for this plan.",
    actionLabel: expiresSoon ? "If you need uninterrupted access, contact your workspace admin before it ends." : null,
    planName,
    expiresAt,
    cycleEndsAt,
    remainingCompletedTurns: null,
    completedTurnLimit,
    reasonCode: null
  };
}

export type PortalStatusLocale = "en" | "zh-CN";

const PORTAL_STATUS_ZH: Record<string, string> = {
  "Access is available": "可正常使用",
  "Your internal workspace is not currently using a separate subscription limit.": "你所在的内部组织目前没有单独的订阅额度限制。",
  "You can keep sending AI requests without setting up a personal plan.": "无需开通个人套餐即可继续发起 AI 请求。",
  "A plan is required": "需要开通套餐",
  "Your workspace has not enabled access yet.": "你的组织尚未开通使用权限。",
  "Ask your workspace admin to assign a plan before you send an AI request.": "请先联系组织管理员分配套餐，再发起 AI 请求。",
  "Contact your workspace admin to enable access.": "请联系组织管理员开通权限。",
  "Access is unavailable": "暂不可用",
  "You can send a new AI request.": "你可以发起新的 AI 请求。",
  "You cannot send a new AI request right now.": "你目前无法发起新的 AI 请求。",
  "Please contact your workspace admin for help.": "请联系组织管理员协助处理。",
  "Access is paused": "权限已暂停",
  "This plan is currently paused for new AI requests.": "该套餐目前已暂停新的 AI 请求。",
  "You can keep reading earlier chats, but you will need your admin to resume access before sending a new AI request.": "你仍可查看历史对话；如需发起新的 AI 请求，需要管理员恢复权限。",
  "Ask your workspace admin to resume this plan.": "请联系组织管理员恢复该套餐。",
  "Access starts soon": "即将生效",
  "Your plan has been scheduled, but it is not active yet.": "你的套餐已排期，但尚未生效。",
  "You can send AI requests as soon as the plan begins.": "套餐生效后即可发起 AI 请求。",
  "If this start date looks wrong, contact your workspace admin.": "如果生效日期有误，请联系组织管理员。",
  "Your access has ended": "权限已到期",
  "This plan is no longer active for new AI requests.": "该套餐已不再支持新的 AI 请求。",
  "Ask your workspace admin to renew access, then try again.": "请联系组织管理员续期后再试。",
  "Contact your workspace admin for a renewal.": "请联系组织管理员续期。",
  "This workspace is temporarily unavailable": "当前组织暂时不可用",
  "This plan has reached its service capacity for the current cycle.": "该套餐本周期的服务容量已用完。",
  "You can keep reading earlier chats. To send a new AI request, wait for the next reset or ask your admin for more capacity.": "你仍可查看历史对话。如需发起新的 AI 请求，请等待下次重置或联系管理员增加容量。",
  "Try again after the next cycle reset or contact your workspace admin.": "请在下个周期重置后再试，或联系组织管理员。",
  "AI request limit reached": "AI 请求次数已用完",
  "You have used all AI requests included in this cycle.": "本周期包含的 AI 请求次数已全部用完。",
  "You can keep reading earlier chats. To send a new AI request, wait for the next reset or ask your admin to adjust the plan.": "你仍可查看历史对话。如需发起新的 AI 请求，请等待下次重置或联系管理员调整套餐。",
  "Access ends soon": "即将到期",
  "Access is active": "权限有效",
  "Your plan is active, but it is approaching its end date.": "套餐当前有效，但即将到期。",
  "You can keep sending AI requests within the current cycle.": "本周期内可继续发起 AI 请求。",
  "If you need uninterrupted access, contact your workspace admin before it ends.": "如需不间断使用，请在到期前联系组织管理员。",
  "Your plan is active for AI requests.": "你的套餐当前可用于 AI 请求。",
  "No AI request limit is currently shown for this plan.": "该套餐目前未显示 AI 请求次数上限。",
  "Blocked by your personal plan": "受个人套餐限制",
  "Managed through your personal plan": "由个人套餐提供",
  "Blocked by your workspace plan": "受组织套餐限制",
  "Managed through your workspace plan": "由组织套餐提供",
  "Included by your internal workspace": "内部组织默认包含",
  "A workspace plan is required": "需要组织套餐"
};

/** Translates the fixed portal status copy; dynamic messages pass through unchanged. */
export function localizePortalStatus(status: PortalSubscriptionStatus, locale: PortalStatusLocale = "en"): PortalSubscriptionStatus {
  if (locale !== "zh-CN") return status;
  const tr = (value: string | null): string | null => {
    if (!value) return value;
    const left = /^(\d+) AI requests? left in this cycle\.$/.exec(value);
    if (left) return `本周期剩余 ${left[1]} 次 AI 请求。`;
    return PORTAL_STATUS_ZH[value] ?? value;
  };
  return {
    ...status,
    sourceLabel: tr(status.sourceLabel) ?? status.sourceLabel,
    title: tr(status.title) ?? status.title,
    summary: tr(status.summary) ?? status.summary,
    detail: tr(status.detail) ?? status.detail,
    actionLabel: tr(status.actionLabel)
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
    const usedTokens = usageEvents.reduce((sum, item) => sum + usageTotalTokens(item.inputTokens, item.outputTokens), 0);

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
      return defaultDecision(input.currentUser);
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
      message: "Plan is available.",
      userGrant: userEvaluation,
      organizationGrant: organizationEvaluation,
      defaultPolicy: null
    };
  }

  async getPortalSubscriptionStatus(input: {
    currentUser: CurrentActor;
    model: string;
    now?: Date;
    locale?: PortalStatusLocale;
  }): Promise<PortalSubscriptionStatus> {
    const now = input.now ?? new Date();
    const decision = await this.evaluateAccessForChat({
      currentUser: input.currentUser,
      model: input.model,
      now
    });
    return localizePortalStatus(buildPortalStatus({
      decision,
      now
    }), input.locale);
  }

  private buildPortalDeniedMessage(decision: ChatAccessDecision): string {
    const status = buildPortalStatus({
      decision,
      now: new Date()
    });
    return `${status.title}. ${status.detail}`.trim();
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
        title: failingEvaluation?.access.title ?? "Access is not enabled",
        detail: decision.message,
        model: input.model,
        metadata: {
          defaultPolicy: decision.defaultPolicy,
          userGrantId: decision.userGrant?.grant.id ?? null,
          organizationGrantId: decision.organizationGrant?.grant.id ?? null
        }
      });
    }

    throw new ChatAccessDeniedError(this.buildPortalDeniedMessage(decision), decision.reasonCode);
  }
}
