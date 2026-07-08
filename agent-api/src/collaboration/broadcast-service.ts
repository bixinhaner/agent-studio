import type {
  BroadcastAudienceSnapshot,
  BroadcastDraftInput,
  BroadcastRecord,
  BroadcastRepository,
  BroadcastTargetRecord,
  BroadcastUpdateInput
} from "../persistence/broadcast-repository.js";
import type { AuthEmailSender } from "../auth/email.js";
import type { NotificationRecordRepository, NotificationRecord } from "../persistence/notification-record-repository.js";
import type { SystemSettingsBranding } from "../system-settings/types.js";
import type { CollaborationInboxProjectionInput, InboxProjectionService } from "./inbox-projection-service.js";
import type { BroadcastAudiencePreview, BroadcastAudienceRecipient, BroadcastAudienceResolver } from "./broadcast-audience.js";
import { renderBroadcastEmail } from "./broadcast-email-template.js";

type BroadcastRecipientDirectory = {
  listAllUserIds?: () => Promise<string[]>;
  listUserIdsForDepartment?: (departmentId: string) => Promise<string[]>;
  listUserIdsForRole?: (roleId: string) => Promise<string[]>;
};

type BroadcastNotificationDispatcher = {
  dispatchBroadcast?: (input: {
    broadcast: BroadcastRecord;
    recipientUserIds: string[];
  }) => Promise<void>;
};

type BroadcastAuthorizer = {
  canCreateBroadcast?: (input: { actorUserId: string }) => Promise<boolean>;
  canUpdateBroadcast?: (input: { actorUserId: string; broadcastId: string }) => Promise<boolean>;
  canPublishBroadcast?: (input: { actorUserId: string; broadcastId: string }) => Promise<boolean>;
};

function uniqueUserIds(userIds: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const userId of userIds) {
    const value = typeof userId === "string" ? userId.trim() : "";
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

export class BroadcastService {
  constructor(
    private readonly deps: {
      broadcasts: Pick<
        BroadcastRepository,
        "createDraft" | "updateDraft" | "publish" | "get" | "markTested" | "updateAudienceSnapshot" | "updateDeliverySummary"
      >;
      inboxProjection?: Pick<InboxProjectionService, "projectCollaborationEvent">;
      recipientDirectory?: BroadcastRecipientDirectory;
      notifications?: BroadcastNotificationDispatcher;
      notificationRecords?: Pick<NotificationRecordRepository, "create" | "update" | "list">;
      audienceResolver?: Pick<BroadcastAudienceResolver, "preview">;
      emailSender?: AuthEmailSender;
      getBranding?: () => Promise<SystemSettingsBranding>;
      portalBaseUrl?: string;
      authorizer?: BroadcastAuthorizer;
    }
  ) {}

  async createDraft(
    input: Omit<BroadcastDraftInput, "createdByUserId"> & {
      actorUserId: string;
    }
  ): Promise<BroadcastRecord> {
    if (!(await this.canCreate(input.actorUserId))) {
      throw new Error("broadcast create access denied");
    }
    return this.deps.broadcasts.createDraft({
      ...input,
      createdByUserId: input.actorUserId
    });
  }

  async updateDraft(
    input: BroadcastUpdateInput & {
      actorUserId: string;
    }
  ): Promise<BroadcastRecord> {
    if (!(await this.canUpdate(input.actorUserId, input.id))) {
      throw new Error("broadcast update access denied");
    }
    return this.deps.broadcasts.updateDraft(input);
  }

  async publish(input: { actorUserId: string; broadcastId: string }): Promise<BroadcastRecord> {
    if (!(await this.canPublish(input.actorUserId, input.broadcastId))) {
      throw new Error("broadcast publish access denied");
    }
    const draft = await this.requireBroadcast(input.broadcastId);
    const audience = await this.previewAudience({ actorUserId: input.actorUserId, broadcastId: input.broadcastId });
    const branding = await this.resolveBranding();
    const currentFingerprint = this.renderForFingerprint(draft, audience.recipients[0], branding);
    if (draft.channels.email && draft.testState.status !== "passed") {
      throw new Error("email campaign must pass a test send before publish");
    }
    if (draft.channels.email && draft.testState.lastFingerprint !== currentFingerprint) {
      throw new Error("email campaign changed after the last successful test");
    }

    const broadcast = await this.deps.broadcasts.publish({
      id: input.broadcastId,
      publishedByUserId: input.actorUserId
    });
    const recipientUserIds = audience.recipients.map((recipient) => recipient.userId);
    let inAppSent = 0;
    let emailSent = 0;
    let emailFailed = 0;
    let dingtalkSent = 0;

    if (broadcast.channels.inApp && recipientUserIds.length > 0 && this.deps.inboxProjection) {
      const projectionInput: CollaborationInboxProjectionInput = {
        eventType: "broadcast.published",
        actorUserId: input.actorUserId,
        recipientUserIds,
        title: broadcast.title,
        body: broadcast.bodyMarkdown,
        relatedEntityType: "broadcast_message",
        relatedEntityId: broadcast.id,
        payload: { broadcastId: broadcast.id },
        category: "broadcast"
      };
      await this.deps.inboxProjection.projectCollaborationEvent(projectionInput);
      inAppSent = recipientUserIds.length;
    }

    if (broadcast.channels.email) {
      const result = await this.sendFormalEmails({
        broadcast,
        recipients: audience.recipients,
        branding
      });
      emailSent = result.sent;
      emailFailed = result.failed;
    }

    if (broadcast.channels.dingtalk) {
      await this.deps.notifications?.dispatchBroadcast?.({
        broadcast,
        recipientUserIds
      });
      dingtalkSent = recipientUserIds.length;
    }

    return this.deps.broadcasts.updateDeliverySummary({
      id: broadcast.id,
      summary: {
        recipientCount: recipientUserIds.length,
        emailSent,
        emailFailed,
        inAppSent,
        dingtalkSent,
        lastPublishedAt: new Date().toISOString()
      }
    });
  }

  async previewAudience(input: { actorUserId: string; broadcastId: string }): Promise<BroadcastAudiencePreview> {
    if (!(await this.canUpdate(input.actorUserId, input.broadcastId))) {
      throw new Error("broadcast update access denied");
    }
    const broadcast = await this.requireBroadcast(input.broadcastId);
    const preview = await this.resolveAudience(broadcast);
    await this.deps.broadcasts.updateAudienceSnapshot({
      id: broadcast.id,
      snapshot: preview.snapshot
    });
    return preview;
  }

  async sendTestEmail(input: {
    actorUserId: string;
    broadcastId: string;
    testEmail: string;
    simulatedUserId?: string;
  }): Promise<{ broadcast: BroadcastRecord; notification: NotificationRecord; delivered: boolean; mode: "smtp" | "debug" }> {
    if (!(await this.canUpdate(input.actorUserId, input.broadcastId))) {
      throw new Error("broadcast update access denied");
    }
    const testEmail = normalizeEmail(input.testEmail);
    if (!testEmail) throw new Error("valid test email is required");
    const broadcast = await this.requireBroadcast(input.broadcastId);
    if (!broadcast.channels.email) throw new Error("email channel is not enabled");
    const audience = await this.resolveAudience(broadcast);
    const simulatedRecipient = this.pickSimulatedRecipient(audience.recipients, input.simulatedUserId);
    const branding = await this.resolveBranding();
    const rendered = renderBroadcastEmail({
      branding,
      content: broadcast.content,
      recipient: simulatedRecipient,
      portalBaseUrl: this.portalBaseUrl()
    });
    const notification = await this.createNotification({
      targetRef: `broadcast:${broadcast.id}:test:${Date.now()}`,
      eventType: "broadcast.test_email",
      status: "pending",
      payload: {
        broadcastId: broadcast.id,
        test: true,
        testEmail,
        simulatedUserId: simulatedRecipient.userId,
        subject: rendered.subject,
        fingerprint: rendered.fingerprint
      }
    });

    try {
      if (!this.deps.emailSender) throw new Error("email sender is not configured");
      const delivery = await this.deps.emailSender.send({
        to: testEmail,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        debugLabel: "broadcast-test-email"
      });
      const updatedNotification = await this.updateNotification(notification.id, {
        status: "sent",
        payload: {
          broadcastId: broadcast.id,
          test: true,
          testEmail,
          simulatedUserId: simulatedRecipient.userId,
          subject: rendered.subject,
          fingerprint: rendered.fingerprint,
          delivery
        },
        errorMessage: null
      });
      const updatedBroadcast = await this.deps.broadcasts.markTested({
        id: broadcast.id,
        status: delivery.delivered ? "passed" : "failed",
        fingerprint: rendered.fingerprint
      });
      return {
        broadcast: updatedBroadcast,
        notification: updatedNotification,
        delivered: delivery.delivered,
        mode: delivery.mode
      };
    } catch (error) {
      await this.updateNotification(notification.id, {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "test email failed"
      });
      const updatedBroadcast = await this.deps.broadcasts.markTested({
        id: broadcast.id,
        status: "failed",
        fingerprint: rendered.fingerprint
      });
      throw Object.assign(error instanceof Error ? error : new Error("test email failed"), { broadcast: updatedBroadcast });
    }
  }

  async listDeliveries(input: { actorUserId: string; broadcastId: string }): Promise<NotificationRecord[]> {
    if (!(await this.canUpdate(input.actorUserId, input.broadcastId))) {
      throw new Error("broadcast update access denied");
    }
    if (!this.deps.notificationRecords) return [];
    const [email, test, dingtalk] = await Promise.all([
      this.deps.notificationRecords.list({ eventType: "broadcast.email", take: 500 }),
      this.deps.notificationRecords.list({ eventType: "broadcast.test_email", take: 100 }),
      this.deps.notificationRecords.list({ targetRef: input.broadcastId, eventType: "broadcast.published", take: 100 })
    ]);
    return [...email.filter((item) => item.targetRef.startsWith(`broadcast:${input.broadcastId}:email`)), ...test.filter((item) => {
      const payload = item.payload && typeof item.payload === "object" ? item.payload as Record<string, unknown> : {};
      return payload.broadcastId === input.broadcastId;
    }), ...dingtalk];
  }

  private async canPublish(actorUserId: string, broadcastId: string): Promise<boolean> {
    if (!this.deps.authorizer?.canPublishBroadcast) {
      return true;
    }
    return this.deps.authorizer.canPublishBroadcast({ actorUserId, broadcastId });
  }

  private async canCreate(actorUserId: string): Promise<boolean> {
    if (!this.deps.authorizer?.canCreateBroadcast) {
      return true;
    }
    return this.deps.authorizer.canCreateBroadcast({ actorUserId });
  }

  private async canUpdate(actorUserId: string, broadcastId: string): Promise<boolean> {
    if (!this.deps.authorizer?.canUpdateBroadcast) {
      return true;
    }
    return this.deps.authorizer.canUpdateBroadcast({ actorUserId, broadcastId });
  }

  private async requireBroadcast(broadcastId: string): Promise<BroadcastRecord> {
    const broadcast = await this.deps.broadcasts.get(broadcastId);
    if (!broadcast) throw new Error("broadcast not found");
    return broadcast;
  }

  private async resolveAudience(broadcast: BroadcastRecord): Promise<BroadcastAudiencePreview> {
    if (this.deps.audienceResolver) {
      return this.deps.audienceResolver.preview(broadcast.audience);
    }
    const recipientUserIds = await this.resolveRecipients(broadcast.targets);
    const recipients = recipientUserIds.map((userId) => ({
      userId,
      status: "active"
    }));
    return {
      recipients,
      snapshot: fallbackAudienceSnapshot(recipients),
      excluded: { disabled: 0, missingEmail: 0, emailOptOut: 0, rules: 0 }
    };
  }

  private pickSimulatedRecipient(recipients: BroadcastAudienceRecipient[], simulatedUserId: string | undefined): BroadcastAudienceRecipient {
    if (simulatedUserId) {
      const selected = recipients.find((recipient) => recipient.userId === simulatedUserId);
      if (!selected) throw new Error("simulated recipient is not in the current audience");
      return selected;
    }
    const first = recipients[0];
    if (!first) throw new Error("audience has no email-reachable recipients");
    return first;
  }

  private async resolveBranding(): Promise<SystemSettingsBranding> {
    if (this.deps.getBranding) return this.deps.getBranding();
    return {
      platformName: "Agent Studio",
      headerSubtitle: "Enterprise Agent Platform",
      internalLoginCopy: "Sign in to continue.",
      externalLoginCopy: "Welcome. Sign in to continue.",
      logoUrl: "",
      iconUrl: "",
      loginBackgroundUrl: "",
      portalWelcomeIllustrationUrl: "",
      assistantName: "AI Assistant",
      assistantAvatarUrl: ""
    };
  }

  private portalBaseUrl(): string {
    return (this.deps.portalBaseUrl || "").trim().replace(/\/+$/, "") || "https://bailey.baicells.com";
  }

  private renderForFingerprint(
    broadcast: BroadcastRecord,
    recipient: BroadcastAudienceRecipient | undefined,
    branding: SystemSettingsBranding
  ): string {
    const safeRecipient = recipient ?? { userId: "preview", status: "active", displayName: "Preview User", email: "preview@example.com" };
    return renderBroadcastEmail({
      branding,
      content: broadcast.content,
      recipient: safeRecipient,
      portalBaseUrl: this.portalBaseUrl()
    }).fingerprint;
  }

  private async sendFormalEmails(input: {
    broadcast: BroadcastRecord;
    recipients: BroadcastAudienceRecipient[];
    branding: SystemSettingsBranding;
  }): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    for (const recipient of input.recipients) {
      const email = normalizeEmail(recipient.email);
      if (!email) continue;
      const rendered = renderBroadcastEmail({
        branding: input.branding,
        content: input.broadcast.content,
        recipient,
        portalBaseUrl: this.portalBaseUrl()
      });
      const notification = await this.createNotification({
        targetRef: `broadcast:${input.broadcast.id}:email:${recipient.userId}`,
        eventType: "broadcast.email",
        status: "pending",
        payload: {
          broadcastId: input.broadcast.id,
          userId: recipient.userId,
          email,
          subject: rendered.subject,
          fingerprint: rendered.fingerprint
        }
      });
      try {
        if (!this.deps.emailSender) throw new Error("email sender is not configured");
        const delivery = await this.deps.emailSender.send({
          to: email,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
          debugLabel: "broadcast-email"
        });
        await this.updateNotification(notification.id, {
          status: "sent",
          payload: {
            broadcastId: input.broadcast.id,
            userId: recipient.userId,
            email,
            subject: rendered.subject,
            fingerprint: rendered.fingerprint,
            delivery
          },
          errorMessage: null
        });
        sent += 1;
      } catch (error) {
        await this.updateNotification(notification.id, {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "email delivery failed"
        });
        failed += 1;
      }
    }
    return { sent, failed };
  }

  private async createNotification(input: {
    targetRef: string;
    eventType: string;
    status: "pending" | "sent" | "failed";
    payload: unknown;
  }): Promise<NotificationRecord> {
    if (!this.deps.notificationRecords) {
      throw new Error("notification records are not configured");
    }
    return this.deps.notificationRecords.create({
      channelType: "email",
      targetRef: input.targetRef,
      eventType: input.eventType,
      status: input.status,
      payload: input.payload
    });
  }

  private async updateNotification(
    notificationId: string,
    changes: {
      status?: "pending" | "sent" | "failed";
      payload?: unknown;
      errorMessage?: string | null;
    }
  ): Promise<NotificationRecord> {
    if (!this.deps.notificationRecords) {
      throw new Error("notification records are not configured");
    }
    return this.deps.notificationRecords.update({
      id: notificationId,
      changes
    });
  }

  private async resolveRecipients(targets: BroadcastTargetRecord[]): Promise<string[]> {
    const recipients: string[] = [];
    for (const target of targets) {
      if (target.targetType === "all_users") {
        recipients.push(...((await this.deps.recipientDirectory?.listAllUserIds?.()) ?? []));
        continue;
      }
      if (target.targetType === "department") {
        recipients.push(...((await this.deps.recipientDirectory?.listUserIdsForDepartment?.(target.targetId ?? "")) ?? []));
        continue;
      }
      recipients.push(...((await this.deps.recipientDirectory?.listUserIdsForRole?.(target.targetId ?? "")) ?? []));
    }
    return uniqueUserIds(recipients);
  }
}

function normalizeEmail(value: string | null | undefined): string | undefined {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

function fallbackAudienceSnapshot(recipients: Array<{ userId: string }>): BroadcastAudienceSnapshot {
  return {
    recipientCount: recipients.length,
    emailReachableCount: 0,
    internalCount: 0,
    externalCount: 0,
    excludedCount: 0,
    sampleRecipients: recipients.slice(0, 20).map((recipient) => ({ userId: recipient.userId })),
    calculatedAt: new Date().toISOString()
  };
}
