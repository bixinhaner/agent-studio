import { AlertEventRepository, type AlertEventRecord } from "../persistence/alert-event-repository.js";
import { AlertRuleRepository } from "../persistence/alert-rule-repository.js";

type NotificationDispatchLike = {
  dispatchAlert(event: AlertEventRecord): Promise<void>;
};

export type QuotaAlertEvaluationInput = {
  organizationId?: string;
  scopeType: string;
  scopeId: string;
  metricType: string;
  triggeredValue: string | number;
  thresholdValue: string | number;
  alertRuleId?: string;
};

export type SecurityDenialPattern = {
  deniedCount: number;
  thresholdCount?: number;
};

export type SecurityAlertEvaluationInput = {
  organizationId?: string;
  scopeType: string;
  scopeId: string;
  resourceType?: string;
  resourceId?: string;
  actionType?: string;
  resultStatus?: string;
  userId?: string;
  threadId?: string;
  sessionId?: string;
  denialPattern?: SecurityDenialPattern;
  alertRuleId?: string;
};

export class AlertEvaluationService {
  constructor(
    private readonly deps: {
      alertRules: AlertRuleRepository;
      alertEvents: AlertEventRepository;
      notifications?: NotificationDispatchLike;
    }
  ) {}

  async evaluateQuotaResult(input: QuotaAlertEvaluationInput): Promise<AlertEventRecord | undefined> {
    const triggeredValue = toNumber(input.triggeredValue);
    const thresholdValue = toNumber(input.thresholdValue);
    if (!Number.isFinite(triggeredValue) || !Number.isFinite(thresholdValue) || triggeredValue < thresholdValue) {
      return undefined;
    }

    const matchingRules = await this.deps.alertRules.listActive({
      organizationId: input.organizationId,
      scopeType: input.scopeType as "platform" | "department",
      scopeId: input.scopeId,
      ruleType: "quota_threshold"
    });
    const rule = selectFirstMatchingRule(matchingRules, {
      metricType: input.metricType
    });
    if (!rule) {
      return undefined;
    }
    const event = await this.deps.alertEvents.create({
      organizationId: input.organizationId,
      alertRuleId: input.alertRuleId ?? rule.id,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      severity: "warning",
      status: "open",
      title: "Quota soft block triggered",
      detail: `Metric ${input.metricType} reached ${formatNumber(triggeredValue)} against ${formatNumber(thresholdValue)}`,
      payload: {
        category: "quota",
        metricType: input.metricType,
        triggeredValue: formatNumber(triggeredValue),
        thresholdValue: formatNumber(thresholdValue),
        channels: rule.channels
      }
    });

    await this.dispatchNotification(event);
    return event;
  }

  async evaluateSecurityEvent(input: SecurityAlertEvaluationInput): Promise<AlertEventRecord | undefined> {
    const accessDenied = isDeniedResult(input.resultStatus);
    const denialPattern = input.denialPattern;
    if (!accessDenied && !denialPattern) {
      return undefined;
    }

    if (!accessDenied && denialPattern && !isRepeatedDenial(denialPattern)) {
      return undefined;
    }

    const matchingRules = await this.deps.alertRules.listActive({
      organizationId: input.organizationId,
      scopeType: input.scopeType as "platform" | "department",
      scopeId: input.scopeId,
      ruleType: "security_event"
    });
    const rule = selectFirstMatchingRule(matchingRules, {
      actionType: input.actionType,
      resourceType: input.resourceType
    });
    if (!rule) {
      return undefined;
    }
    const repeated = Boolean(denialPattern && isRepeatedDenial(denialPattern));
    const event = await this.deps.alertEvents.create({
      organizationId: input.organizationId,
      alertRuleId: input.alertRuleId ?? rule.id,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      severity: repeated ? "critical" : "warning",
      status: "open",
      title: repeated ? "Repeated permission denial detected" : "Denied resource access detected",
      detail: repeated
        ? `Denied ${denialPattern?.deniedCount ?? 0} times against threshold ${denialPattern?.thresholdCount ?? 0}`
        : `Access to ${input.resourceType ?? "resource"} ${input.resourceId ? `(${input.resourceId}) ` : ""}was denied`,
      payload: {
        category: repeated ? "permission_denial_pattern" : "resource_access_denied",
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        actionType: input.actionType,
        resultStatus: input.resultStatus,
        userId: input.userId,
        threadId: input.threadId,
        sessionId: input.sessionId,
        denialPattern: denialPattern
          ? {
              deniedCount: denialPattern.deniedCount,
              thresholdCount: denialPattern.thresholdCount ?? 3
            }
          : undefined,
        channels: rule.channels
      }
    });

    await this.dispatchNotification(event);
    return event;
  }

  private async dispatchNotification(event: AlertEventRecord): Promise<void> {
    if (!this.deps.notifications) return;
    try {
      await this.deps.notifications.dispatchAlert(event);
    } catch {
      // Alert creation must survive notification failures.
    }
  }
}

function selectFirstMatchingRule<T extends { conditions?: unknown }>(
  rules: Array<T & { id: string; channels: string[] }>,
  criteria: { metricType?: string; actionType?: string; resourceType?: string }
): (T & { id: string; channels: string[] }) | undefined {
  return rules.find((rule) => {
    const conditions = asRecord(rule.conditions);
    if (!conditions) return true;
    if (typeof conditions.metricType === "string" && conditions.metricType !== criteria.metricType) {
      return false;
    }
    if (typeof conditions.actionType === "string" && conditions.actionType !== criteria.actionType) {
      return false;
    }
    if (typeof conditions.resourceType === "string" && conditions.resourceType !== criteria.resourceType) {
      return false;
    }
    return true;
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isDeniedResult(value: string | undefined): boolean {
  if (!value) return false;
  return ["denied", "forbidden", "blocked", "rejected"].includes(value.toLowerCase());
}

function isRepeatedDenial(pattern: SecurityDenialPattern): boolean {
  const threshold = pattern.thresholdCount ?? 3;
  return pattern.deniedCount >= threshold;
}

function toNumber(value: string | number): number {
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function formatNumber(value: number): string {
  return value.toFixed(2);
}
