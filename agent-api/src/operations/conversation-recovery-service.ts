import type { AuthEmailSender } from "../auth/email.js";
import type { BillingService } from "../billing/service.js";
import type { NotificationRecordRepository } from "../persistence/notification-record-repository.js";

export type ConversationRecoveryStatus = "open" | "ready_to_notify" | "notified" | "closed";
export type ConversationRecoveryStatusFilter = "all" | ConversationRecoveryStatus;

export type ConversationRecoveryCaseRecord = {
  id: string;
  recoveryKey: string;
  organizationId?: string;
  userId?: string;
  threadId?: string;
  source: string;
  channel: string;
  audience: "internal" | "external" | "unknown";
  status: ConversationRecoveryStatus;
  severity: string;
  reasonCode: string;
  title: string;
  questionPreview?: string;
  failureDetail?: string;
  rootCause?: string;
  resolutionSummary?: string;
  recipientEmail?: string;
  emailSubject?: string;
  emailBodyText?: string;
  emailNotificationId?: string;
  compensationPlanId?: string;
  compensationDays?: number;
  compensationOrderId?: string;
  compensationGrantId?: string;
  failureCount: number;
  metadata?: unknown;
  occurredAt: string;
  lastOccurredAt: string;
  notifiedAt?: string;
  compensatedAt?: string;
  closedAt?: string;
  createdByUserId?: string;
  updatedByUserId?: string;
  createdAt: string;
  updatedAt: string;
  user: ConversationRecoveryUser | null;
  organization: ConversationRecoveryOrganization | null;
  suggestedEmail: ConversationRecoveryEmailDraft;
  compensation: {
    eligible: boolean;
    reason: string;
    defaultPlanId?: string;
  };
};

export type ConversationRecoveryUser = {
  id: string;
  userType: string;
  displayName: string | null;
  email: string | null;
  role: string;
  status: string;
};

export type ConversationRecoveryOrganization = {
  id: string;
  slug: string;
  name: string;
  type: string;
  status: string;
};

export type ConversationRecoveryPlan = {
  id: string;
  slug: string;
  name: string;
  status: string;
  featureType: string;
};

export type ConversationRecoveryEmailDraft = {
  recipientEmail?: string;
  subject: string;
  bodyText: string;
  templates: {
    zh: ConversationRecoveryEmailTemplateDraft;
    en: ConversationRecoveryEmailTemplateDraft;
  };
};

export type ConversationRecoveryEmailTemplateDraft = {
  language: "zh" | "en";
  subject: string;
  bodyText: string;
};

export type ConversationRecoveryListResponse = {
  filters: {
    query: string;
    status: ConversationRecoveryStatusFilter;
  };
  summary: {
    totalCases: number;
    openCount: number;
    readyToNotifyCount: number;
    notifiedCount: number;
    closedCount: number;
    externalCount: number;
    emailReadyCount: number;
    compensatedCount: number;
  };
  page: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
  cases: ConversationRecoveryCaseRecord[];
  plans: ConversationRecoveryPlan[];
};

type ConversationRecoveryDb = {
  conversationRecoveryCase: {
    upsert(args: { where: { recoveryKey: string }; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<ConversationRecoveryCaseRow>;
    findUnique(args: { where: { id: string } | { recoveryKey: string } }): Promise<ConversationRecoveryCaseRow | null>;
    findMany(args?: Record<string, unknown>): Promise<ConversationRecoveryCaseRow[]>;
    count(args?: Record<string, unknown>): Promise<number>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<ConversationRecoveryCaseRow>;
  };
  user: {
    findMany(args?: Record<string, unknown>): Promise<UserRow[]>;
  };
  organization: {
    findMany(args?: Record<string, unknown>): Promise<OrganizationRow[]>;
    findUnique(args: { where: { id: string }; select?: Record<string, unknown> }): Promise<OrganizationRow | null>;
  };
  billingCustomer: {
    findUnique(args: { where: { organizationId: string }; select?: Record<string, unknown> }): Promise<BillingCustomerRow | null>;
  };
  subscriptionPlan: {
    findMany(args?: Record<string, unknown>): Promise<SubscriptionPlanRow[]>;
    findUnique(args: { where: { id: string } }): Promise<SubscriptionPlanRow | null>;
  };
  subscriptionGrant: {
    findUnique(args: { where: { principalType_principalId: { principalType: string; principalId: string } } }): Promise<SubscriptionGrantRow | null>;
  };
};

type ConversationRecoveryCaseRow = {
  id: string;
  recoveryKey: string;
  organizationId: string | null;
  userId: string | null;
  threadId: string | null;
  source: string;
  channel: string;
  audience: string;
  status: string;
  severity: string;
  reasonCode: string;
  title: string;
  questionPreview: string | null;
  failureDetail: string | null;
  rootCause: string | null;
  resolutionSummary: string | null;
  recipientEmail: string | null;
  emailSubject: string | null;
  emailBodyText: string | null;
  emailNotificationId: string | null;
  compensationPlanId: string | null;
  compensationDays: number | null;
  compensationOrderId: string | null;
  compensationGrantId: string | null;
  failureCount: number;
  metadata: unknown;
  occurredAt: Date | string;
  lastOccurredAt: Date | string;
  notifiedAt: Date | string | null;
  compensatedAt: Date | string | null;
  closedAt: Date | string | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type UserRow = {
  id: string;
  userType: string | null;
  displayName: string | null;
  email: string | null;
  role?: string | null;
  status: string | null;
};

type OrganizationRow = {
  id: string;
  slug: string;
  name: string;
  type: string | null;
  status: string | null;
};

type BillingCustomerRow = {
  billingEmail: string | null;
  businessEmail: string | null;
};

type SubscriptionPlanRow = {
  id: string;
  slug: string;
  name: string;
  status: string | null;
  featureType: string | null;
};

type SubscriptionGrantRow = {
  planId: string | null;
};

type ConversationRecoveryCaseBase = Omit<
  ConversationRecoveryCaseRecord,
  "user" | "organization" | "suggestedEmail" | "compensation"
>;
type RecoveryEmailIssueKind = "response_failure" | "experience_report" | "product_feedback_reply";

export class ConversationRecoveryService {
  constructor(
    private readonly deps: {
      db: ConversationRecoveryDb;
      emailSender: AuthEmailSender;
      notifications: Pick<NotificationRecordRepository, "create" | "update">;
      billing: Pick<BillingService, "grantGiftDays">;
      resolveBrandName?: () => string | Promise<string>;
      resolvePortalUrl?: () => string | Promise<string>;
    }
  ) {}

  async recordFailure(input: {
    recoveryKey: string;
    organizationId?: string | null;
    userId?: string | null;
    threadId?: string | null;
    source: string;
    channel: string;
    audience?: "internal" | "external" | "unknown";
    severity?: string;
    reasonCode?: string;
    title: string;
    questionPreview?: string | null;
    failureDetail?: string | null;
    recipientEmail?: string | null;
    metadata?: unknown;
    occurredAt?: Date;
  }): Promise<ConversationRecoveryCaseRecord> {
    const recoveryKey = trimOrUndefined(input.recoveryKey);
    const source = trimOrUndefined(input.source);
    const channel = trimOrUndefined(input.channel);
    const title = summarize(input.title, 200);
    if (!recoveryKey || !source || !channel || !title) {
      throw new Error("recoveryKey, source, channel, and title are required");
    }
    const now = input.occurredAt ?? new Date();
    const row = await this.deps.db.conversationRecoveryCase.upsert({
      where: { recoveryKey },
      create: {
        recoveryKey,
        organizationId: trimOrUndefined(input.organizationId ?? undefined) ?? null,
        userId: trimOrUndefined(input.userId ?? undefined) ?? null,
        threadId: trimOrUndefined(input.threadId ?? undefined) ?? null,
        source,
        channel,
        audience: input.audience ?? "unknown",
        severity: trimOrUndefined(input.severity) ?? "high",
        reasonCode: trimOrUndefined(input.reasonCode) ?? "runtime_error",
        title,
        questionPreview: summarizeOrNull(input.questionPreview, 500),
        failureDetail: summarizeOrNull(input.failureDetail, 1000),
        recipientEmail: normalizeEmail(input.recipientEmail),
        metadata: input.metadata ?? null,
        occurredAt: now,
        lastOccurredAt: now
      },
      update: {
        lastOccurredAt: now,
        failureCount: { increment: 1 },
        questionPreview: summarizeOrNull(input.questionPreview, 500),
        failureDetail: summarizeOrNull(input.failureDetail, 1000),
        metadata: input.metadata ?? null
      }
    });
    return this.hydrate(row);
  }

  async list(input: {
    query?: string;
    status?: ConversationRecoveryStatusFilter;
    page?: number;
    pageSize?: number;
  } = {}): Promise<ConversationRecoveryListResponse> {
    const query = trimOrUndefined(input.query) ?? "";
    const status = normalizeStatusFilter(input.status);
    const page = Math.max(1, Math.floor(input.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize ?? 20)));
    const where = recoveryWhere({ query, status });
    const [rows, totalItems, allRows, plans] = await Promise.all([
      this.deps.db.conversationRecoveryCase.findMany({
        where,
        orderBy: [{ lastOccurredAt: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.deps.db.conversationRecoveryCase.count({ where }),
      this.deps.db.conversationRecoveryCase.findMany({ where }),
      this.listPlans()
    ]);
    return {
      filters: { query, status },
      summary: buildSummary(allRows),
      page: {
        page,
        pageSize,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / pageSize))
      },
      cases: await this.hydrateMany(rows, plans),
      plans
    };
  }

  async get(caseId: string): Promise<{ case: ConversationRecoveryCaseRecord; plans: ConversationRecoveryPlan[] }> {
    const row = await this.getCaseRow(caseId);
    const plans = await this.listPlans();
    return { case: await this.hydrate(row, plans), plans };
  }

  async updateStatus(input: {
    caseId: string;
    status: ConversationRecoveryStatus;
    actorUserId?: string | null;
  }): Promise<ConversationRecoveryCaseRecord> {
    const status = normalizeStatus(input.status);
    const now = new Date();
    const row = await this.deps.db.conversationRecoveryCase.update({
      where: { id: input.caseId },
      data: {
        status,
        closedAt: status === "closed" ? now : null,
        updatedByUserId: trimOrUndefined(input.actorUserId ?? undefined) ?? null
      }
    });
    return this.hydrate(row);
  }

  async sendResolutionEmail(input: {
    caseId: string;
    recipientEmail?: string | null;
    subject: string;
    bodyText: string;
    templateLanguage?: string | null;
    rootCause?: string | null;
    resolutionSummary?: string | null;
    actorUserId?: string | null;
  }): Promise<{ case: ConversationRecoveryCaseRecord; notificationId: string; delivered: boolean; mode: "smtp" | "debug" }> {
    const row = await this.getCaseRow(input.caseId);
    const hydrated = await this.hydrate(row);
    const brandName = await this.resolveBrandName();
    const portalUrl = await this.resolvePortalUrl();
    const recipientEmail = normalizeEmail(input.recipientEmail) ?? normalizeEmail(hydrated.suggestedEmail.recipientEmail);
    const subject = trimOrUndefined(input.subject);
    const bodyText = trimOrUndefined(input.bodyText);
    if (!recipientEmail) {
      throw new Error("recipient email is required");
    }
    if (!subject || !bodyText) {
      throw new Error("email subject and body are required");
    }

    const templateLanguage = normalizeEmailTemplateLanguage(input.templateLanguage);
    const payload = {
      category: "conversation_recovery",
      caseId: row.id,
      recoveryKey: row.recoveryKey,
      organizationId: row.organizationId,
      userId: row.userId,
      threadId: row.threadId,
      source: row.source,
      channel: row.channel,
      recipientEmail,
      subject,
      templateLanguage
    };
    const notification = await this.deps.notifications.create({
      organizationId: row.organizationId ?? undefined,
      channelType: "email",
      targetRef: `conversation_recovery:${row.id}:email`,
      eventType: "conversation_recovery.resolution_email",
      status: "pending",
      payload
    });

    try {
      const delivery = await this.deps.emailSender.send({
        to: recipientEmail,
        subject,
        text: bodyText,
        html: recoveryEmailHtml({
          brandName,
          subject,
          bodyText,
          templateLanguage,
          organizationName: hydrated.organization?.name ?? undefined,
          lastOccurredAt: hydrated.lastOccurredAt,
          resolutionSummary: trimOrUndefined(input.resolutionSummary ?? undefined) ?? hydrated.resolutionSummary,
          compensationDays: compensationDaysForEmail(row),
          portalUrl,
          issueKind: recoveryEmailIssueKind(row)
        }),
        debugLabel: "conversation-recovery-email"
      });
      await this.deps.notifications.update({
        id: notification.id,
        changes: {
          status: "sent",
          errorMessage: null,
          payload: {
            ...payload,
            delivered: delivery.delivered,
            deliveryMode: delivery.mode
          }
        }
      });
      const updated = await this.deps.db.conversationRecoveryCase.update({
        where: { id: row.id },
        data: {
          status: "notified",
          rootCause: trimOrUndefined(input.rootCause ?? undefined) ?? row.rootCause,
          resolutionSummary: trimOrUndefined(input.resolutionSummary ?? undefined) ?? row.resolutionSummary,
          recipientEmail,
          emailSubject: subject,
          emailBodyText: bodyText,
          emailNotificationId: notification.id,
          notifiedAt: new Date(),
          updatedByUserId: trimOrUndefined(input.actorUserId ?? undefined) ?? null
        }
      });
      return {
        case: await this.hydrate(updated),
        notificationId: notification.id,
        delivered: delivery.delivered,
        mode: delivery.mode
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "email delivery failed";
      await this.deps.notifications.update({
        id: notification.id,
        changes: {
          status: "failed",
          errorMessage: detail,
          payload
        }
      });
      throw error;
    }
  }

  async grantCompensationDays(input: {
    caseId: string;
    planId?: string | null;
    days: number;
    reason?: string | null;
    actorUserId?: string | null;
  }): Promise<{ case: ConversationRecoveryCaseRecord; order: unknown; grant: unknown }> {
    const row = await this.getCaseRow(input.caseId);
    if (row.compensationOrderId) {
      throw new Error("compensation was already granted for this recovery case");
    }
    const organizationId = trimOrUndefined(row.organizationId);
    if (!organizationId) {
      throw new Error("organization is required before granting compensation");
    }
    const organization = await this.deps.db.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, slug: true, name: true, type: true, status: true }
    });
    if (!organization || organization.type !== "customer") {
      throw new Error("compensation days can only be granted to external customer organizations");
    }
    const planId = trimOrUndefined(input.planId ?? undefined) ?? (await this.defaultPlanIdForOrganization(organizationId));
    if (!planId) {
      throw new Error("subscription plan is required before granting compensation");
    }
    const days = Math.max(1, Math.floor(input.days || 0));
    const reason =
      trimOrUndefined(input.reason ?? undefined) ??
      `Conversation recovery compensation for case ${row.id}`;
    const result = await this.deps.billing.grantGiftDays({
      organizationId,
      planId,
      days,
      reason,
      userId: trimOrUndefined(input.actorUserId ?? undefined) ?? null
    });
    const order = asRecord(result.order);
    const grant = asRecord(result.grant);
    const updated = await this.deps.db.conversationRecoveryCase.update({
      where: { id: row.id },
      data: {
        compensationPlanId: planId,
        compensationDays: days,
        compensationOrderId: stringFromRecord(order, "id"),
        compensationGrantId: stringFromRecord(grant, "id"),
        compensatedAt: new Date(),
        updatedByUserId: trimOrUndefined(input.actorUserId ?? undefined) ?? null
      }
    });
    return {
      case: await this.hydrate(updated),
      order: result.order,
      grant: result.grant
    };
  }

  private async getCaseRow(caseId: string): Promise<ConversationRecoveryCaseRow> {
    const id = trimOrUndefined(caseId);
    if (!id) throw new Error("recovery case id is required");
    const row = await this.deps.db.conversationRecoveryCase.findUnique({ where: { id } });
    if (!row) throw new Error("recovery case does not exist");
    return row;
  }

  private async hydrate(
    row: ConversationRecoveryCaseRow,
    plans?: ConversationRecoveryPlan[]
  ): Promise<ConversationRecoveryCaseRecord> {
    const [record] = await this.hydrateMany([row], plans);
    if (!record) throw new Error("recovery case does not exist");
    return record;
  }

  private async hydrateMany(
    rows: ConversationRecoveryCaseRow[],
    plansInput?: ConversationRecoveryPlan[]
  ): Promise<ConversationRecoveryCaseRecord[]> {
    const userIds = unique(rows.map((row) => row.userId));
    const organizationIds = unique(rows.map((row) => row.organizationId));
    const [users, organizations, billingCustomers, plans, grants, brandName] = await Promise.all([
      userIds.length
        ? this.deps.db.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, userType: true, displayName: true, email: true, role: true, status: true }
          })
        : [],
      organizationIds.length
        ? this.deps.db.organization.findMany({
            where: { id: { in: organizationIds } },
            select: { id: true, slug: true, name: true, type: true, status: true }
          })
        : [],
      Promise.all(
        organizationIds.map(async (organizationId) => ({
          organizationId,
          customer: await this.deps.db.billingCustomer.findUnique({
            where: { organizationId },
            select: { billingEmail: true, businessEmail: true }
          })
        }))
      ),
      plansInput ?? this.listPlans(),
      Promise.all(
        organizationIds.map(async (organizationId) => ({
          organizationId,
          grant: await this.deps.db.subscriptionGrant.findUnique({
            where: { principalType_principalId: { principalType: "organization", principalId: organizationId } }
          })
        }))
      ),
      this.resolveBrandName()
    ]);
    const userById = new Map(users.map((user) => [user.id, mapUser(user)]));
    const organizationById = new Map(organizations.map((organization) => [organization.id, mapOrganization(organization)]));
    const billingCustomerByOrg = new Map(billingCustomers.map((item) => [item.organizationId, item.customer]));
    const grantPlanByOrg = new Map(grants.map((item) => [item.organizationId, item.grant?.planId ?? undefined]));
    const firstActivePlan = plans.find((plan) => plan.status === "active") ?? plans[0];

    return rows.map((row) => {
      const user = row.userId ? userById.get(row.userId) ?? null : null;
      const organization = row.organizationId ? organizationById.get(row.organizationId) ?? null : null;
      const billingCustomer = row.organizationId ? billingCustomerByOrg.get(row.organizationId) ?? null : null;
      const base = mapCaseRow(row);
      const audience = resolveAudience(base.audience, user, organization);
      const recipientEmail =
        normalizeEmail(row.recipientEmail) ??
        normalizeEmail(user?.email) ??
        normalizeEmail(billingCustomer?.billingEmail) ??
        normalizeEmail(billingCustomer?.businessEmail);
      const defaultPlanId =
        row.compensationPlanId ??
        (row.organizationId ? grantPlanByOrg.get(row.organizationId) : undefined) ??
        firstActivePlan?.id;
      return {
        ...base,
        audience,
        user,
        organization,
        suggestedEmail: buildEmailDraft({
          brandName,
          row: base,
          user,
          organization,
          recipientEmail
        }),
        compensation: compensationState({
          audience,
          organization,
          defaultPlanId,
          alreadyCompensated: Boolean(row.compensationOrderId)
        })
      };
    });
  }

  private async listPlans(): Promise<ConversationRecoveryPlan[]> {
    const plans = await this.deps.db.subscriptionPlan.findMany({
      where: { status: "active" },
      orderBy: [{ billingStatus: "asc" }, { name: "asc" }],
      select: { id: true, slug: true, name: true, status: true, featureType: true }
    });
    return plans.map((plan) => ({
      id: plan.id,
      slug: plan.slug,
      name: plan.name,
      status: plan.status ?? "active",
      featureType: plan.featureType ?? "chat"
    }));
  }

  private async defaultPlanIdForOrganization(organizationId: string): Promise<string | undefined> {
    const grant = await this.deps.db.subscriptionGrant.findUnique({
      where: { principalType_principalId: { principalType: "organization", principalId: organizationId } }
    });
    if (grant?.planId) return grant.planId;
    const [plan] = await this.listPlans();
    return plan?.id;
  }

  private async resolveBrandName(): Promise<string> {
    const resolved = await this.deps.resolveBrandName?.();
    return trimOrUndefined(resolved) ?? "AgentStudio";
  }

  private async resolvePortalUrl(): Promise<string> {
    const resolved = await this.deps.resolvePortalUrl?.();
    return trimOrUndefined(resolved)?.replace(/\/+$/, "") || "https://bailey.baicells.com";
  }
}

function recoveryWhere(input: { query: string; status: ConversationRecoveryStatusFilter }) {
  const where: Record<string, unknown> = {};
  if (input.status !== "all") {
    where.status = input.status;
  }
  if (input.query) {
    where.OR = [
      { title: { contains: input.query, mode: "insensitive" } },
      { questionPreview: { contains: input.query, mode: "insensitive" } },
      { failureDetail: { contains: input.query, mode: "insensitive" } },
      { recipientEmail: { contains: input.query, mode: "insensitive" } },
      { recoveryKey: { contains: input.query, mode: "insensitive" } },
      { threadId: { contains: input.query, mode: "insensitive" } }
    ];
  }
  return where;
}

function mapCaseRow(row: ConversationRecoveryCaseRow): ConversationRecoveryCaseBase {
  return {
    id: row.id,
    recoveryKey: row.recoveryKey,
    organizationId: trimOrUndefined(row.organizationId ?? undefined),
    userId: trimOrUndefined(row.userId ?? undefined),
    threadId: trimOrUndefined(row.threadId ?? undefined),
    source: row.source,
    channel: row.channel,
    audience: normalizeAudience(row.audience),
    status: normalizeStatus(row.status),
    severity: row.severity,
    reasonCode: row.reasonCode,
    title: row.title,
    questionPreview: trimOrUndefined(row.questionPreview ?? undefined),
    failureDetail: trimOrUndefined(row.failureDetail ?? undefined),
    rootCause: trimOrUndefined(row.rootCause ?? undefined),
    resolutionSummary: trimOrUndefined(row.resolutionSummary ?? undefined),
    recipientEmail: trimOrUndefined(row.recipientEmail ?? undefined),
    emailSubject: trimOrUndefined(row.emailSubject ?? undefined),
    emailBodyText: trimOrUndefined(row.emailBodyText ?? undefined),
    emailNotificationId: trimOrUndefined(row.emailNotificationId ?? undefined),
    compensationPlanId: trimOrUndefined(row.compensationPlanId ?? undefined),
    compensationDays: Number.isFinite(row.compensationDays) ? row.compensationDays ?? undefined : undefined,
    compensationOrderId: trimOrUndefined(row.compensationOrderId ?? undefined),
    compensationGrantId: trimOrUndefined(row.compensationGrantId ?? undefined),
    failureCount: Math.max(1, Math.floor(row.failureCount || 1)),
    metadata: row.metadata ?? undefined,
    occurredAt: toIsoString(row.occurredAt),
    lastOccurredAt: toIsoString(row.lastOccurredAt),
    notifiedAt: toOptionalIsoString(row.notifiedAt),
    compensatedAt: toOptionalIsoString(row.compensatedAt),
    closedAt: toOptionalIsoString(row.closedAt),
    createdByUserId: trimOrUndefined(row.createdByUserId ?? undefined),
    updatedByUserId: trimOrUndefined(row.updatedByUserId ?? undefined),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

function mapUser(row: UserRow): ConversationRecoveryUser {
  return {
    id: row.id,
    userType: trimOrUndefined(row.userType) ?? "internal_employee",
    displayName: trimOrUndefined(row.displayName) ?? null,
    email: normalizeEmail(row.email) ?? null,
    role: trimOrUndefined(row.role) ?? "employee",
    status: trimOrUndefined(row.status) ?? "active"
  };
}

function mapOrganization(row: OrganizationRow): ConversationRecoveryOrganization {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    type: trimOrUndefined(row.type) ?? "customer",
    status: trimOrUndefined(row.status) ?? "active"
  };
}

function buildSummary(rows: ConversationRecoveryCaseRow[]): ConversationRecoveryListResponse["summary"] {
  const mapped = rows.map(mapCaseRow);
  return {
    totalCases: rows.length,
    openCount: mapped.filter((item) => item.status === "open").length,
    readyToNotifyCount: mapped.filter((item) => item.status === "ready_to_notify").length,
    notifiedCount: mapped.filter((item) => item.status === "notified").length,
    closedCount: mapped.filter((item) => item.status === "closed").length,
    externalCount: mapped.filter((item) => item.audience === "external").length,
    emailReadyCount: mapped.filter((item) => Boolean(item.recipientEmail)).length,
    compensatedCount: mapped.filter((item) => Boolean(item.compensationOrderId)).length
  };
}

function buildEmailDraft(input: {
  brandName: string;
  row: ConversationRecoveryCaseBase;
  user: ConversationRecoveryUser | null;
  organization: ConversationRecoveryOrganization | null;
  recipientEmail?: string;
}): ConversationRecoveryEmailDraft {
  const zhTemplate = buildZhEmailTemplate(input);
  const enTemplate = buildEnEmailTemplate(input);
  const existingSubject = input.row.emailSubject;
  const existingBodyText = input.row.emailBodyText;
  return {
    recipientEmail: input.recipientEmail,
    subject: existingSubject ?? zhTemplate.subject,
    bodyText: existingBodyText ?? zhTemplate.bodyText,
    templates: {
      zh: zhTemplate,
      en: enTemplate
    }
  };
}

function buildZhEmailTemplate(input: {
  brandName: string;
  row: ConversationRecoveryCaseBase;
  user: ConversationRecoveryUser | null;
  organization: ConversationRecoveryOrganization | null;
}): ConversationRecoveryEmailTemplateDraft {
  const issueKind = recoveryEmailIssueKind(input.row);
  const copy = recoveryEmailTextCopy(input.brandName, "zh", issueKind);
  const displayName = trimOrUndefined(input.user?.displayName ?? undefined) ?? "您好";
  const organizationName = trimOrUndefined(input.organization?.name ?? undefined);
  const occurredAt = new Date(input.row.lastOccurredAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  const compensationNotice = recoveryCompensationNotice(compensationDaysForEmail(input.row), "zh", input.brandName);
  const bodyLines: Array<string | null> = [
    `${displayName}，`,
    "",
    copy.lead,
    `相关时间：${occurredAt}`,
    organizationName ? `关联组织：${organizationName}` : null,
    `当前状态：${copy.ready}`,
    "",
    `${copy.explanation}：`,
    input.row.resolutionSummary || defaultRecoveryResolution("zh", input.brandName, issueKind),
    ...(compensationNotice ? ["", "权益补偿：", compensationNotice] : []),
    "",
    `您可以重新进入 ${input.brandName} 继续使用。`,
    "",
    copy.footer
  ];
  return {
    language: "zh",
    subject: copy.subject,
    bodyText: bodyLines.filter((line): line is string => line !== null).join("\n")
  };
}

function buildEnEmailTemplate(input: {
  brandName: string;
  row: ConversationRecoveryCaseBase;
  user: ConversationRecoveryUser | null;
  organization: ConversationRecoveryOrganization | null;
}): ConversationRecoveryEmailTemplateDraft {
  const issueKind = recoveryEmailIssueKind(input.row);
  const copy = recoveryEmailTextCopy(input.brandName, "en", issueKind);
  const displayName = trimOrUndefined(input.user?.displayName ?? undefined) ?? "Hello";
  const organizationName = trimOrUndefined(input.organization?.name ?? undefined);
  const occurredAt = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  }).format(new Date(input.row.lastOccurredAt));
  const compensationNotice = recoveryCompensationNotice(compensationDaysForEmail(input.row), "en", input.brandName);
  const bodyLines: Array<string | null> = [
    `${displayName},`,
    "",
    copy.lead,
    `Related time: ${occurredAt} UTC`,
    organizationName ? `Organization: ${organizationName}` : null,
    `Current status: ${copy.ready}`,
    "",
    `${copy.explanation}:`,
    input.row.resolutionSummary || defaultRecoveryResolution("en", input.brandName, issueKind),
    ...(compensationNotice ? ["", "Access credit:", compensationNotice] : []),
    "",
    `You can return to ${input.brandName} and continue using it.`,
    "",
    copy.footer
  ];
  return {
    language: "en",
    subject: copy.subject,
    bodyText: bodyLines.filter((line): line is string => line !== null).join("\n")
  };
}

function compensationState(input: {
  audience: "internal" | "external" | "unknown";
  organization: ConversationRecoveryOrganization | null;
  defaultPlanId?: string;
  alreadyCompensated: boolean;
}): ConversationRecoveryCaseRecord["compensation"] {
  if (input.alreadyCompensated) {
    return { eligible: false, reason: "already_compensated", defaultPlanId: input.defaultPlanId };
  }
  if (!input.organization) {
    return { eligible: false, reason: "missing_organization", defaultPlanId: input.defaultPlanId };
  }
  if (input.organization.type !== "customer" || input.audience !== "external") {
    return { eligible: false, reason: "internal_or_non_customer", defaultPlanId: input.defaultPlanId };
  }
  if (!input.defaultPlanId) {
    return { eligible: false, reason: "missing_plan", defaultPlanId: input.defaultPlanId };
  }
  return { eligible: true, reason: "eligible", defaultPlanId: input.defaultPlanId };
}

function resolveAudience(
  existing: "internal" | "external" | "unknown",
  user: ConversationRecoveryUser | null,
  organization: ConversationRecoveryOrganization | null
): "internal" | "external" | "unknown" {
  if (user?.userType === "external_user" || organization?.type === "customer") return "external";
  if (user?.userType === "internal_employee" || organization?.type === "internal") return "internal";
  return existing;
}

function normalizeStatus(value: unknown): ConversationRecoveryStatus {
  return value === "ready_to_notify" || value === "notified" || value === "closed" ? value : "open";
}

function normalizeStatusFilter(value: unknown): ConversationRecoveryStatusFilter {
  return value === "open" || value === "ready_to_notify" || value === "notified" || value === "closed" ? value : "all";
}

function normalizeAudience(value: unknown): "internal" | "external" | "unknown" {
  return value === "internal" || value === "external" ? value : "unknown";
}

function normalizeEmailTemplateLanguage(value: string | null | undefined): "zh" | "en" {
  return value === "en" ? "en" : "zh";
}

function recoveryEmailIssueKind(row: { source: string; reasonCode: string }): RecoveryEmailIssueKind {
  if (
    row.source === "conversation_negative_feedback" ||
    row.source.startsWith("product_feedback_") ||
    row.reasonCode === "negative_feedback" ||
    row.reasonCode.startsWith("product_feedback_")
  ) {
    return "experience_report";
  }
  return "response_failure";
}

export function recoveryEmailHtml(input: {
  brandName: string;
  subject: string;
  bodyText: string;
  templateLanguage: "zh" | "en";
  organizationName?: string;
  lastOccurredAt: string;
  resolutionSummary?: string;
  compensationDays?: number;
  portalUrl: string;
  issueKind: RecoveryEmailIssueKind;
  inlineImages?: Array<{
    cid: string;
    name: string;
  }>;
}): string {
  const copy = recoveryEmailCopy(input.brandName, input.templateLanguage, input.issueKind);
  const occurredAt = formatRecoveryEmailTime(input.lastOccurredAt, input.templateLanguage);
  const resolution = trimOrUndefined(input.resolutionSummary)
    ?? extractResolutionSummary(input.bodyText, input.templateLanguage)
    ?? defaultRecoveryResolution(input.templateLanguage, input.brandName, input.issueKind);
  const organizationRows = input.organizationName
    ? recoverySummaryRow(copy.organization, input.organizationName)
    : "";
  const compensationNotice = recoveryCompensationNotice(input.compensationDays, input.templateLanguage, input.brandName);
  const compensationBlock = compensationNotice
    ? recoveryCompensationBlock(copy.compensation, compensationNotice)
    : "";
  const inlineImagesBlock = recoveryInlineImagesBlock(input.inlineImages, input.templateLanguage);
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#fafafa;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#fafafa;margin:0;padding:28px 0;">
      <tr>
        <td align="center" style="padding:0 14px;">
          <table role="presentation" width="620" cellspacing="0" cellpadding="0" border="0" style="width:620px;max-width:620px;background:#ffffff;border:1px solid #e5e7eb;border-radius:20px;border-collapse:separate;overflow:hidden;">
            <tr>
              <td style="padding:30px 34px 20px;font-family:Arial,Helvetica,sans-serif;color:#111827;background:#ffffff;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="vertical-align:middle;">
                      <span style="display:inline-block;width:12px;height:12px;border-radius:999px;background:#FF4614;margin-right:8px;vertical-align:middle;"></span>
                      <span style="font-size:15px;line-height:22px;font-weight:bold;color:#111827;vertical-align:middle;">${escapeHtml(input.brandName)}</span>
                    </td>
                    <td align="right" style="vertical-align:middle;">
                      <span style="display:inline-block;border:1px solid #fed7c7;background:#fff4ef;color:#C83A12;border-radius:999px;padding:6px 10px;font-size:12px;line-height:16px;font-weight:bold;">${escapeHtml(copy.status)}</span>
                    </td>
                  </tr>
                </table>
                <h1 style="margin:24px 0 10px;font-size:28px;line-height:36px;font-weight:bold;color:#111827;">${escapeHtml(copy.h1)}</h1>
                <p style="margin:0;font-size:15px;line-height:24px;color:#4b5563;">${escapeHtml(copy.lead)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 34px 20px;font-family:Arial,Helvetica,sans-serif;color:#111827;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f9fafb;border:1px solid #eef0f3;border-radius:14px;border-collapse:separate;">
                  ${recoverySummaryRow(copy.relatedTime, occurredAt)}
                  ${organizationRows}
                  ${recoverySummaryRow(copy.currentStatus, copy.ready)}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 34px 24px;font-family:Arial,Helvetica,sans-serif;color:#111827;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#fff7ed;border:1px solid #fed7aa;border-radius:14px;border-collapse:separate;">
                  <tr>
                    <td style="padding:16px 18px 4px;">
                      <p style="margin:0;font-size:13px;line-height:20px;font-weight:bold;color:#C83A12;">${escapeHtml(copy.explanation)}</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 18px 10px;">
                      ${textToHtmlLines(resolution)}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            ${compensationBlock}
            ${inlineImagesBlock}
            <tr>
              <td align="center" style="padding:0 34px 30px;font-family:Arial,Helvetica,sans-serif;">
                <a href="${escapeHtml(input.portalUrl)}" style="display:inline-block;background:#FF4614;color:#ffffff;text-decoration:none;border-radius:12px;padding:13px 20px;font-size:15px;line-height:20px;font-weight:bold;">${escapeHtml(copy.cta)}</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 34px 24px;font-family:Arial,Helvetica,sans-serif;color:#6b7280;border-top:1px solid #f3f4f6;background:#ffffff;">
                <p style="margin:0;font-size:12px;line-height:19px;">${escapeHtml(copy.footer)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function recoveryInlineImagesBlock(
  images: Array<{ cid: string; name: string }> | undefined,
  language: "zh" | "en"
): string {
  if (!images?.length) return "";
  const title = language === "en" ? "Illustration" : "操作示意";
  const figures = images
    .map((image, index) => {
      const caption = language === "en"
        ? `Figure ${index + 1}: ${image.name}`
        : `图 ${index + 1}：${image.name}`;
      return `<tr>
                    <td style="padding:${index === 0 ? "0" : "16px"} 0 0;">
                      <img src="cid:${escapeHtml(image.cid)}" alt="${escapeHtml(image.name)}" width="552" style="display:block;width:100%;max-width:552px;height:auto;border:1px solid #e5e7eb;border-radius:10px;background:#f9fafb;" />
                      <p style="margin:7px 0 0;font-size:12px;line-height:18px;color:#6b7280;">${escapeHtml(caption)}</p>
                    </td>
                  </tr>`;
    })
    .join("");
  return `<tr>
              <td style="padding:0 34px 24px;font-family:Arial,Helvetica,sans-serif;color:#111827;">
                <p style="margin:0 0 10px;font-size:13px;line-height:20px;font-weight:bold;color:#C83A12;">${escapeHtml(title)}</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  ${figures}
                </table>
              </td>
            </tr>`;
}

function recoveryEmailTextCopy(brandName: string, language: "zh" | "en", issueKind: RecoveryEmailIssueKind) {
  if (language === "en") {
    if (issueKind === "product_feedback_reply") {
      return {
        subject: `${brandName} has an update on your feedback`,
        lead: "We reviewed the feedback you submitted and completed the related follow-up.",
        ready: "Ready to continue",
        explanation: "Resolution details",
        footer: `This email follows up on feedback you submitted to ${brandName}.`
      };
    }
    if (issueKind === "experience_report") {
      return {
        subject: `${brandName} has addressed a recent experience report`,
        lead: "We completed a proactive follow-up based on recent service experience signals.",
        ready: "Ready to continue",
        explanation: "Follow-up details",
        footer: `This email is a proactive ${brandName} service follow-up and does not include your conversation content.`
      };
    }
    return {
      subject: `${brandName} has addressed a recent response interruption`,
      lead: "We detected an incomplete response and addressed the related issue.",
      ready: "Ready to continue",
      explanation: "What we addressed",
      footer: `This email is a proactive ${brandName} service follow-up and does not include your conversation content.`
    };
  }
  if (issueKind === "product_feedback_reply") {
    return {
      subject: `${brandName} 已更新您的反馈处理结果`,
      lead: "我们已完成您所提交反馈的排查和跟进。",
      ready: "可以继续使用",
      explanation: "处理说明",
      footer: `这封邮件用于跟进您向 ${brandName} 提交的反馈。`
    };
  }
  if (issueKind === "experience_report") {
    return {
      subject: `${brandName} 已处理一次体验反馈`,
      lead: "我们根据近期服务体验信号完成了一次主动跟进，并已处理相关问题。",
      ready: "可以继续使用",
      explanation: "跟进说明",
      footer: `这封邮件是 ${brandName} 对近期服务体验的一次主动跟进，不包含您的具体对话内容。`
    };
  }
  return {
    subject: `${brandName} 已处理一次响应中断`,
    lead: "我们检测到一次回答未能完成，并已处理相关问题。",
    ready: "可以继续使用",
    explanation: "处理说明",
    footer: `这封邮件是 ${brandName} 对近期服务体验的一次主动跟进，不包含您的具体对话内容。`
  };
}

function defaultRecoveryResolution(language: "zh" | "en", brandName: string, issueKind: RecoveryEmailIssueKind): string {
  if (language === "en") {
    if (issueKind === "product_feedback_reply") {
      return `We have reviewed and addressed the feedback you submitted. You can return to ${brandName} and continue using it. If the issue appears again, reply to this email and we will follow up.`;
    }
    return issueKind === "experience_report"
      ? `We have reviewed and addressed the related service experience signal. You can return to ${brandName} and continue using it. If the same issue appears again, reply to this email and we will follow up.`
      : `We have reviewed and addressed the service-side issue. You can return to ${brandName} and continue using it. If the same issue appears again, reply to this email and we will follow up.`;
  }
  if (issueKind === "product_feedback_reply") {
    return `我们已完成您所提交反馈的排查和处理。您可以重新进入 ${brandName} 继续使用；如果相同问题再次出现，可以直接回复这封邮件，我们会继续跟进。`;
  }
  return issueKind === "experience_report"
    ? `我们已完成相关服务体验信号的排查和处理。您可以重新进入 ${brandName} 继续使用；如果相同问题再次出现，可以直接回复这封邮件，我们会继续跟进。`
    : `我们已完成服务侧排查和处理。您可以重新进入 ${brandName} 继续使用；如果相同问题再次出现，可以直接回复这封邮件，我们会继续跟进。`;
}

function recoveryEmailCopy(brandName: string, language: "zh" | "en", issueKind: RecoveryEmailIssueKind) {
  if (language === "en") {
    if (issueKind === "product_feedback_reply") {
      return {
        status: "Feedback addressed",
        h1: "We have an update on your feedback",
        lead: `Thank you for your feedback. The related follow-up is complete, and you can continue using ${brandName}.`,
        relatedTime: "Feedback Time",
        organization: "Organization",
        currentStatus: "Current Status",
        ready: "Ready to continue",
        explanation: "Resolution details",
        compensation: "Access credit",
        cta: `Continue using ${brandName}`,
        footer: `This email follows up on feedback you submitted to ${brandName}. Selected images are included only when needed to explain the resolution.`
      };
    }
    if (issueKind === "experience_report") {
      return {
        status: "Experience report addressed",
        h1: "We completed a service experience follow-up",
        lead: `The related follow-up has been handled. You can continue using ${brandName}.`,
        relatedTime: "Related Time",
        organization: "Organization",
        currentStatus: "Current Status",
        ready: "Ready to continue",
        explanation: "Follow-up details",
        compensation: "Access credit",
        cta: `Continue using ${brandName}`,
        footer: `This email is a proactive ${brandName} service follow-up and does not include your conversation content.`
      };
    }
    return {
      status: "Service issue addressed",
      h1: "We detected an incomplete response and addressed the issue",
      lead: `The related service issue has been handled. You can continue using ${brandName}.`,
      relatedTime: "Related Time",
      organization: "Organization",
      currentStatus: "Current Status",
      ready: "Ready to continue",
      explanation: "What we addressed",
      compensation: "Access credit",
      cta: `Continue using ${brandName}`,
      footer: `This email is a proactive ${brandName} service follow-up and does not include your conversation content.`
    };
  }
  if (issueKind === "product_feedback_reply") {
    return {
      status: "问题已处理",
      h1: "您的反馈已有处理结果",
      lead: `感谢您的反馈。相关问题已经完成处理，您可以继续使用 ${brandName}。`,
      relatedTime: "反馈时间",
      organization: "关联组织",
      currentStatus: "当前状态",
      ready: "可以继续使用",
      explanation: "处理说明",
      compensation: "权益补偿",
      cta: `继续使用 ${brandName}`,
      footer: `这封邮件用于跟进您向 ${brandName} 提交的反馈；仅在解释处理结果所需时包含您选择的图片。`
    };
  }
  if (issueKind === "experience_report") {
    return {
      status: "体验反馈已跟进",
      h1: "我们已完成一次服务体验跟进",
      lead: `相关体验跟进已经处理完成。您可以继续使用 ${brandName}。`,
      relatedTime: "相关时间",
      organization: "关联组织",
      currentStatus: "当前状态",
      ready: "可以继续使用",
      explanation: "跟进说明",
      compensation: "权益补偿",
      cta: `继续使用 ${brandName}`,
      footer: `这封邮件是 ${brandName} 对近期服务体验的一次主动跟进，不包含您的具体对话内容。`
    };
  }
  return {
    status: "服务问题已处理",
    h1: "我们检测到一次回答未能完成，并已处理相关问题",
    lead: `相关服务问题已经处理完成。您可以继续使用 ${brandName}。`,
    relatedTime: "相关时间",
    organization: "关联组织",
    currentStatus: "当前状态",
    ready: "可以继续使用",
    explanation: "处理说明",
    compensation: "权益补偿",
    cta: `继续使用 ${brandName}`,
    footer: `这封邮件是 ${brandName} 对近期服务体验的一次主动跟进，不包含您的具体对话内容。`
  };
}

function compensationDaysForEmail(row: { compensationDays?: number | null; compensationOrderId?: string | null }): number | undefined {
  if (!trimOrUndefined(row.compensationOrderId ?? undefined)) return undefined;
  const days = Number(row.compensationDays ?? 0);
  return Number.isFinite(days) && days > 0 ? Math.floor(days) : undefined;
}

function recoveryCompensationNotice(days: number | undefined, language: "zh" | "en", brandName: string): string | undefined {
  if (!days) return undefined;
  if (language === "en") {
    const unit = days === 1 ? "day" : "days";
    return `We have added ${days} ${unit} of access to your organization. You can continue using ${brandName}.`;
  }
  return `我们已为您的组织增加 ${days} 天使用权益，您可以继续使用 ${brandName}。`;
}

function recoveryCompensationBlock(label: string, message: string): string {
  return `<tr>
              <td style="padding:0 34px 24px;font-family:Arial,Helvetica,sans-serif;color:#111827;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;border-collapse:separate;">
                  <tr>
                    <td style="padding:16px 18px 4px;">
                      <p style="margin:0;font-size:13px;line-height:20px;font-weight:bold;color:#15803d;">${escapeHtml(label)}</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 18px 10px;">
                      ${textToHtmlLines(message)}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`;
}

function recoverySummaryRow(label: string, value: string): string {
  return `<tr>
                    <td style="padding:12px 16px;border-bottom:1px solid #eef0f3;font-size:12px;line-height:18px;color:#6b7280;width:38%;">${escapeHtml(label)}</td>
                    <td style="padding:12px 16px;border-bottom:1px solid #eef0f3;font-size:13px;line-height:19px;color:#111827;font-weight:bold;">${escapeHtml(value)}</td>
                  </tr>`;
}

function formatRecoveryEmailTime(value: string, language: "zh" | "en"): string {
  const date = new Date(value);
  if (language === "en") {
    return `${new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC"
    }).format(date)} UTC`;
  }
  return date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}

function extractResolutionSummary(bodyText: string, language: "zh" | "en"): string | undefined {
  const labels = language === "en" ? ["What we addressed:", "Follow-up details:"] : ["处理说明：", "跟进说明："];
  for (const label of labels) {
    const index = bodyText.indexOf(label);
    if (index < 0) continue;
    const afterLabel = bodyText.slice(index + label.length).trim();
    const firstBlock = afterLabel.split(/\n{2,}/)[0]?.trim();
    return trimOrUndefined(firstBlock);
  }
  return undefined;
}

function textToHtmlLines(value: string): string {
  return escapeHtml(value)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p style="margin:0 0 8px;font-size:14px;line-height:22px;color:#374151;">${line}</p>`)
    .join("");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function summarizeOrNull(value: string | null | undefined, limit: number): string | null {
  const result = summarize(value ?? "", limit);
  return result || null;
}

function summarize(value: string, limit: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return "";
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 3))}...`;
}

function normalizeEmail(value: string | null | undefined): string | undefined {
  const normalized = trimOrUndefined(value)?.toLowerCase();
  if (!normalized || !normalized.includes("@")) return undefined;
  return normalized;
}

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => trimOrUndefined(value ?? undefined)).filter(Boolean) as string[])];
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function toOptionalIsoString(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  return toIsoString(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stringFromRecord(record: Record<string, unknown> | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
