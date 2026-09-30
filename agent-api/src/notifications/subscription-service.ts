import type { NotificationSubscription, PrismaClient, ProactiveAgentFinding } from "@prisma/client";

import { computeNextRunAt, isValidTimeOfDay, isValidTimezone } from "../scheduled-tasks/schedule.js";
import type { DingTalkPushService } from "./dingtalk-push-service.js";

export const SUBSCRIPTION_TARGET_TYPES = ["user", "department", "role"] as const;
export type SubscriptionTargetType = (typeof SUBSCRIPTION_TARGET_TYPES)[number];
export const SEVERITY_ORDER = ["info", "low", "medium", "high", "critical"] as const;
export type SubscriptionSeverity = (typeof SEVERITY_ORDER)[number];

export const PROACTIVE_SCENARIOS: Record<string, { zh: string; en: string }> = {
  "task-failure-analysis": { zh: "任务失败智能分析", en: "Task failure analysis" },
  "access-review-assistant": { zh: "设备接入审核助手", en: "Device access review" },
  "severe-alarm-explanation": { zh: "严重告警解释", en: "Severe alarm explanation" },
  "daily-operations-summary": { zh: "每日运维摘要", en: "Daily operations summary" }
};

const SOURCE_TYPE = "proactive_finding";
const MAX_FINDINGS_PER_MESSAGE = 8;

type SubscriptionDb = Pick<
  PrismaClient,
  "notificationSubscription" | "proactiveAgentFinding" | "departmentMembership" | "department" | "userRole" | "user" | "notificationDelivery"
>;

export class SubscriptionValidationError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

export type SubscriptionInput = {
  targetType: SubscriptionTargetType;
  targetId: string;
  scenarioKey?: string | null;
  connectorId?: string | null;
  minSeverity?: SubscriptionSeverity;
  deliveryMode?: "realtime" | "digest";
  digestTime?: string | null;
  timezone?: string;
  enabled?: boolean;
};

export function severityRank(value: string): number {
  const index = SEVERITY_ORDER.indexOf(value.toLowerCase() as SubscriptionSeverity);
  return index < 0 ? 0 : index;
}

export function severitiesAtLeast(minSeverity: string): string[] {
  const rank = severityRank(minSeverity);
  return SEVERITY_ORDER.filter((_, index) => index >= rank).flatMap((item) => [item, item.toUpperCase()]);
}

export function subscriptionOut(subscription: NotificationSubscription, targetName?: string) {
  return {
    id: subscription.id,
    target_type: subscription.targetType,
    target_id: subscription.targetId,
    target_name: targetName ?? null,
    source_type: subscription.sourceType,
    scenario_key: subscription.scenarioKey,
    connector_id: subscription.connectorId,
    min_severity: subscription.minSeverity,
    delivery_mode: subscription.deliveryMode,
    digest_time: subscription.digestTime,
    timezone: subscription.timezone,
    enabled: subscription.enabled,
    last_delivered_at: subscription.lastDeliveredAt?.toISOString() ?? null,
    last_error: subscription.lastError,
    created_at: subscription.createdAt.toISOString()
  };
}

function scenarioLabel(key: string, en: boolean): string {
  const entry = PROACTIVE_SCENARIOS[key];
  return entry ? (en ? entry.en : entry.zh) : key;
}

function severityLabel(value: string, en: boolean): string {
  const zh: Record<string, string> = { critical: "紧急", high: "高", medium: "中", low: "低", info: "提示" };
  const key = value.toLowerCase();
  return en ? key.toUpperCase() : zh[key] ?? value;
}

function oneLine(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function buildFindingsMarkdown(findings: ProactiveAgentFinding[], en: boolean): { title: string; markdown: string } {
  if (findings.length === 1) {
    const [finding] = findings;
    const title = en ? `OMC finding: ${oneLine(finding.title, 60)}` : `OMC 主动发现：${oneLine(finding.title, 60)}`;
    return {
      title,
      markdown: [
        `### ${oneLine(finding.title, 120)}`,
        `**${en ? "Scenario" : "场景"}：** ${scenarioLabel(finding.scenarioKey, en)}　**${en ? "Severity" : "级别"}：** ${severityLabel(finding.severity, en)}`,
        oneLine(finding.summary, 600)
      ].join("\n\n")
    };
  }
  const title = en ? `OMC findings: ${findings.length} new` : `OMC 主动发现：新增 ${findings.length} 条`;
  const lines = findings.slice(0, MAX_FINDINGS_PER_MESSAGE).map(
    (finding) =>
      `- **[${severityLabel(finding.severity, en)}] ${oneLine(finding.title, 80)}**（${scenarioLabel(finding.scenarioKey, en)}）\n  ${oneLine(finding.summary, 140)}`
  );
  if (findings.length > MAX_FINDINGS_PER_MESSAGE) {
    lines.push(en ? `- …and ${findings.length - MAX_FINDINGS_PER_MESSAGE} more` : `- …另有 ${findings.length - MAX_FINDINGS_PER_MESSAGE} 条`);
  }
  return { title, markdown: [`### ${title}`, ...lines].join("\n\n") };
}

export function buildDigestMarkdown(findings: ProactiveAgentFinding[], en: boolean, dateLabel: string): { title: string; markdown: string } {
  const title = en ? `OMC daily digest · ${dateLabel}` : `OMC 每日摘要 · ${dateLabel}`;
  if (!findings.length) {
    return { title, markdown: `### ${title}\n\n${en ? "No new findings in the last period." : "本周期内没有新的主动发现。"}` };
  }
  const byScenario = new Map<string, Map<string, number>>();
  for (const finding of findings) {
    const counts = byScenario.get(finding.scenarioKey) ?? new Map<string, number>();
    const severity = finding.severity.toLowerCase();
    counts.set(severity, (counts.get(severity) ?? 0) + 1);
    byScenario.set(finding.scenarioKey, counts);
  }
  const summary = [...byScenario.entries()].map(([scenario, counts]) => {
    const parts = [...counts.entries()]
      .sort((a, b) => severityRank(b[0]) - severityRank(a[0]))
      .map(([severity, count]) => `${severityLabel(severity, en)} ${count}`)
      .join(" / ");
    return `- **${scenarioLabel(scenario, en)}**：${parts}`;
  });
  const top = [...findings]
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 5)
    .map((finding) => `- [${severityLabel(finding.severity, en)}] ${oneLine(finding.title, 90)}`);
  return {
    title,
    markdown: [
      `### ${title}`,
      en ? `**Total:** ${findings.length}` : `**合计：** ${findings.length} 条`,
      ...summary,
      `**${en ? "Top findings" : "重点关注"}**`,
      ...top
    ].join("\n\n")
  };
}

export class NotificationSubscriptionService {
  private timer: NodeJS.Timeout | undefined;
  private ticking = false;

  constructor(
    private readonly options: {
      db: SubscriptionDb;
      push: Pick<DingTalkPushService, "pushClaimed">;
      now?(): Date;
      logger?: Pick<Console, "warn">;
    }
  ) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  normalize(input: SubscriptionInput) {
    if (!SUBSCRIPTION_TARGET_TYPES.includes(input.targetType)) {
      throw new SubscriptionValidationError("Unsupported target", "invalid_target");
    }
    const targetId = input.targetId.trim();
    if (!targetId) throw new SubscriptionValidationError("Target is required", "target_required");
    const deliveryMode = input.deliveryMode === "digest" ? "digest" : "realtime";
    const digestTime = deliveryMode === "digest" ? input.digestTime?.trim() || "09:00" : null;
    if (digestTime && !isValidTimeOfDay(digestTime)) {
      throw new SubscriptionValidationError("Digest time must use HH:MM", "invalid_time");
    }
    const timezone = input.timezone?.trim() || "Asia/Shanghai";
    if (!isValidTimezone(timezone)) throw new SubscriptionValidationError("Unknown timezone", "invalid_timezone");
    const minSeverity = SEVERITY_ORDER.includes(input.minSeverity as SubscriptionSeverity) ? input.minSeverity! : "high";
    const scenarioKey = input.scenarioKey?.trim() || null;
    if (scenarioKey && !PROACTIVE_SCENARIOS[scenarioKey]) {
      throw new SubscriptionValidationError("Unknown scenario", "invalid_scenario");
    }
    return {
      targetType: input.targetType,
      targetId,
      sourceType: SOURCE_TYPE,
      scenarioKey,
      connectorId: input.connectorId?.trim() || null,
      minSeverity,
      deliveryMode,
      digestTime,
      timezone,
      enabled: input.enabled !== false,
      nextDigestAt: digestTime ? computeNextRunAt({ frequency: "daily", timeOfDay: digestTime, timezone }, this.now()) : null
    };
  }

  async listForViewer(viewer: { userId: string; canManageShared: boolean }) {
    const where = viewer.canManageShared
      ? { sourceType: SOURCE_TYPE }
      : { sourceType: SOURCE_TYPE, targetType: "user", targetId: viewer.userId };
    const items = await this.options.db.notificationSubscription.findMany({ where, orderBy: { createdAt: "desc" } });
    const departmentIds = items.filter((item) => item.targetType === "department").map((item) => item.targetId);
    const userIds = items.filter((item) => item.targetType === "user").map((item) => item.targetId);
    const [departments, users] = await Promise.all([
      departmentIds.length
        ? this.options.db.department.findMany({ where: { id: { in: departmentIds } }, select: { id: true, name: true } })
        : [],
      userIds.length
        ? this.options.db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true, email: true } })
        : []
    ]);
    const names = new Map<string, string>([
      ...departments.map((item) => [`department:${item.id}`, item.name] as [string, string]),
      ...users.map((item) => [`user:${item.id}`, item.displayName || item.email || item.id] as [string, string])
    ]);
    return items.map((item) => subscriptionOut(item, names.get(`${item.targetType}:${item.targetId}`) ?? (item.targetType === "role" ? item.targetId : undefined)));
  }

  async create(input: SubscriptionInput & { organizationId: string; createdById: string }) {
    const normalized = this.normalize(input);
    return this.options.db.notificationSubscription.create({
      data: { ...normalized, organizationId: input.organizationId, createdById: input.createdById, cursorAt: this.now() }
    });
  }

  async update(id: string, patch: Partial<SubscriptionInput>, viewer: { userId: string; canManageShared: boolean }) {
    const existing = await this.findEditable(id, viewer);
    if (!existing) return undefined;
    const normalized = this.normalize({
      targetType: existing.targetType as SubscriptionTargetType,
      targetId: existing.targetId,
      scenarioKey: patch.scenarioKey !== undefined ? patch.scenarioKey : existing.scenarioKey,
      connectorId: patch.connectorId !== undefined ? patch.connectorId : existing.connectorId,
      minSeverity: (patch.minSeverity ?? existing.minSeverity) as SubscriptionSeverity,
      deliveryMode: (patch.deliveryMode ?? existing.deliveryMode) as "realtime" | "digest",
      digestTime: patch.digestTime !== undefined ? patch.digestTime : existing.digestTime,
      timezone: patch.timezone ?? existing.timezone,
      enabled: patch.enabled ?? existing.enabled
    });
    return this.options.db.notificationSubscription.update({
      where: { id },
      // Re-enabling starts from "now" so users are not flooded with backlog.
      data: { ...normalized, ...(normalized.enabled && !existing.enabled ? { cursorAt: this.now() } : {}) }
    });
  }

  async remove(id: string, viewer: { userId: string; canManageShared: boolean }): Promise<boolean> {
    const existing = await this.findEditable(id, viewer);
    if (!existing) return false;
    await this.options.db.notificationSubscription.delete({ where: { id } });
    return true;
  }

  private async findEditable(id: string, viewer: { userId: string; canManageShared: boolean }) {
    const existing = await this.options.db.notificationSubscription.findUnique({ where: { id } });
    if (!existing) return undefined;
    if (viewer.canManageShared) return existing;
    return existing.targetType === "user" && existing.targetId === viewer.userId ? existing : undefined;
  }

  /** Resolves active internal recipients with a bound DingTalk account. */
  async resolveRecipients(subscription: Pick<NotificationSubscription, "targetType" | "targetId">): Promise<string[]> {
    let userIds: string[] = [];
    if (subscription.targetType === "user") {
      userIds = [subscription.targetId];
    } else if (subscription.targetType === "department") {
      const departmentIds = await this.departmentWithDescendants(subscription.targetId);
      const memberships = await this.options.db.departmentMembership.findMany({
        where: { departmentId: { in: departmentIds } },
        select: { userId: true }
      });
      userIds = memberships.map((item) => item.userId);
    } else if (subscription.targetType === "role") {
      const roles = await this.options.db.userRole.findMany({
        where: { OR: [{ roleId: subscription.targetId }, { role: { slug: subscription.targetId } }] },
        select: { userId: true }
      });
      userIds = roles.map((item) => item.userId);
    }
    if (!userIds.length) return [];
    const users = await this.options.db.user.findMany({
      where: {
        id: { in: [...new Set(userIds)] },
        status: "active",
        userType: "internal_employee",
        dingtalkUserId: { not: null }
      },
      select: { id: true }
    });
    return users.map((item) => item.id);
  }

  private async departmentWithDescendants(rootId: string): Promise<string[]> {
    const seen = new Set<string>([rootId]);
    let frontier = [rootId];
    for (let depth = 0; depth < 8 && frontier.length; depth += 1) {
      const children = await this.options.db.department.findMany({
        where: { parentDepartmentId: { in: frontier } },
        select: { id: true }
      });
      frontier = children.map((item) => item.id).filter((id) => !seen.has(id));
      frontier.forEach((id) => seen.add(id));
    }
    return [...seen];
  }

  start(intervalMs = 60_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const subscriptions = await this.options.db.notificationSubscription.findMany({
        where: { enabled: true, sourceType: SOURCE_TYPE }
      });
      for (const subscription of subscriptions) {
        try {
          if (subscription.deliveryMode === "digest") await this.deliverDigest(subscription);
          else await this.deliverRealtime(subscription);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          this.options.logger?.warn("notification subscription delivery failed", { id: subscription.id, detail });
          await this.options.db.notificationSubscription
            .update({ where: { id: subscription.id }, data: { lastError: detail.slice(0, 500) } })
            .catch(() => undefined);
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  private findingWhere(subscription: NotificationSubscription, since: Date, until: Date) {
    return {
      createdAt: { gt: since, lte: until },
      severity: { in: severitiesAtLeast(subscription.minSeverity) },
      ...(subscription.scenarioKey ? { scenarioKey: subscription.scenarioKey } : {}),
      ...(subscription.connectorId ? { connectorId: subscription.connectorId } : {})
    };
  }

  private async advanceCursor(subscription: NotificationSubscription, cursorAt: Date, extra: Record<string, unknown> = {}) {
    // Compare-and-set on the cursor so concurrent workers cannot both claim a window.
    const claimed = await this.options.db.notificationSubscription.updateMany({
      where: { id: subscription.id, cursorAt: subscription.cursorAt },
      data: { cursorAt, ...extra }
    });
    return claimed.count === 1;
  }

  private async deliverRealtime(subscription: NotificationSubscription): Promise<void> {
    const until = this.now();
    const findings = await this.options.db.proactiveAgentFinding.findMany({
      where: this.findingWhere(subscription, subscription.cursorAt, until),
      orderBy: { createdAt: "asc" },
      take: 50
    });
    if (!findings.length) return;
    const cursorAt = findings.length === 50 ? findings[findings.length - 1].createdAt : until;
    if (!(await this.advanceCursor(subscription, cursorAt))) return;
    const recipients = await this.resolveRecipients(subscription);
    let delivered = false;
    for (const userId of recipients) {
      const result = await this.options.push.pushClaimed({
        userId,
        subscriptionId: subscription.id,
        items: findings.map((finding) => ({ sourceType: SOURCE_TYPE, sourceId: finding.id })),
        build: (claimedIds, { en }) =>
          buildFindingsMarkdown(findings.filter((finding) => claimedIds.includes(finding.id)), en)
      });
      delivered ||= result === "sent";
    }
    await this.options.db.notificationSubscription.update({
      where: { id: subscription.id },
      data: { ...(delivered ? { lastDeliveredAt: this.now() } : {}), lastError: null }
    });
  }

  private async deliverDigest(subscription: NotificationSubscription): Promise<void> {
    const now = this.now();
    if (!subscription.nextDigestAt || !subscription.digestTime) {
      await this.options.db.notificationSubscription.update({
        where: { id: subscription.id },
        data: {
          nextDigestAt: computeNextRunAt(
            { frequency: "daily", timeOfDay: subscription.digestTime || "09:00", timezone: subscription.timezone },
            now
          )
        }
      });
      return;
    }
    if (subscription.nextDigestAt > now) return;
    const findings = await this.options.db.proactiveAgentFinding.findMany({
      where: this.findingWhere(subscription, subscription.cursorAt, now),
      orderBy: { createdAt: "desc" },
      take: 500
    });
    const nextDigestAt = computeNextRunAt(
      { frequency: "daily", timeOfDay: subscription.digestTime, timezone: subscription.timezone },
      now
    );
    if (!(await this.advanceCursor(subscription, now, { nextDigestAt }))) return;
    const dateLabel = new Intl.DateTimeFormat("zh-CN", {
      timeZone: subscription.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(now);
    const recipients = await this.resolveRecipients(subscription);
    const digestId = `digest:${subscription.id}:${subscription.nextDigestAt.toISOString()}`;
    let delivered = false;
    for (const userId of recipients) {
      const result = await this.options.push.pushClaimed({
        userId,
        subscriptionId: subscription.id,
        items: [{ sourceType: "proactive_digest", sourceId: digestId }],
        build: (_claimed, { en }) => buildDigestMarkdown(findings, en, dateLabel)
      });
      delivered ||= result === "sent";
    }
    await this.options.db.notificationSubscription.update({
      where: { id: subscription.id },
      data: { ...(delivered ? { lastDeliveredAt: now } : {}), lastError: null }
    });
  }
}
