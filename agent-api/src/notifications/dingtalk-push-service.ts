import type { PrismaClient } from "@prisma/client";

export type DingTalkPushSender = {
  hasProactiveSender(): boolean;
  sendOneToOneMessage(input: {
    userIds: string[];
    msgKey: "sampleMarkdown" | "sampleActionCard" | "sampleText";
    msgParam: Record<string, unknown>;
  }): Promise<unknown>;
};

export type DingTalkPushMessage = {
  userId: string;
  sourceType: string;
  sourceId: string;
  subscriptionId?: string;
  title: string;
  markdown: string;
  /** Optional deep link; rendered as an action card button. */
  link?: { url: string; label: string };
};

export type DingTalkPushResult = "sent" | "duplicate" | "skipped_no_dingtalk" | "skipped_no_sender" | "failed";

type PushDb = Pick<PrismaClient, "notificationDelivery" | "user">;

/** Opens the URL inside DingTalk's in-app browser instead of the side drawer. */
export function dingtalkInAppLink(url: string): string {
  return `dingtalk://dingtalkclient/page/link?url=${encodeURIComponent(url)}&pc_slide=false`;
}

function preferredLocale(preferences: unknown): string | undefined {
  const portal = (preferences as { portal?: { locale?: unknown } } | null)?.portal;
  return typeof portal?.locale === "string" ? portal.locale : undefined;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: string }).code === "P2002");
}

/**
 * Sends proactive DingTalk messages exactly once per (user, source, channel).
 * The delivery row is claimed before sending so concurrent workers or
 * retries after a crash never double-deliver.
 */
export class DingTalkPushService {
  constructor(
    private readonly db: PushDb,
    private readonly sender: DingTalkPushSender | undefined,
    private readonly logger: Pick<Console, "warn"> = console
  ) {}

  isAvailable(): boolean {
    return Boolean(this.sender?.hasProactiveSender());
  }

  async push(message: DingTalkPushMessage): Promise<DingTalkPushResult> {
    return this.pushClaimed({
      userId: message.userId,
      subscriptionId: message.subscriptionId,
      items: [{ sourceType: message.sourceType, sourceId: message.sourceId }],
      build: () => ({ title: message.title, markdown: message.markdown, link: message.link })
    });
  }

  /**
   * Claims one delivery row per item for the user, then sends a single message
   * built from only the newly claimed items. Items already delivered to this
   * user (for example via another subscription) are dropped.
   */
  async pushClaimed(input: {
    userId: string;
    subscriptionId?: string;
    items: Array<{ sourceType: string; sourceId: string }>;
    build(claimedSourceIds: string[], context: { en: boolean }): {
      title: string;
      markdown: string;
      link?: { url: string; label: string };
    };
  }): Promise<DingTalkPushResult> {
    const user = await this.db.user.findUnique({
      where: { id: input.userId },
      select: { dingtalkUserId: true, status: true, preferencesJson: true }
    });
    const dingtalkUserId = user?.dingtalkUserId?.trim();
    if (!dingtalkUserId || user?.status !== "active") return "skipped_no_dingtalk";
    if (!this.sender?.hasProactiveSender()) return "skipped_no_sender";

    const claimed: Array<{ deliveryId: string; sourceId: string }> = [];
    for (const item of input.items) {
      try {
        const created = await this.db.notificationDelivery.create({
          data: {
            userId: input.userId,
            sourceType: item.sourceType,
            sourceId: item.sourceId,
            subscriptionId: input.subscriptionId,
            channel: "dingtalk",
            status: "pending"
          },
          select: { id: true }
        });
        claimed.push({ deliveryId: created.id, sourceId: item.sourceId });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    if (!claimed.length) return "duplicate";

    const deliveryIds = claimed.map((item) => item.deliveryId);
    try {
      const message = input.build(
        claimed.map((item) => item.sourceId),
        { en: preferredLocale(user?.preferencesJson) === "en" }
      );
      if (message.link) {
        await this.sender.sendOneToOneMessage({
          userIds: [dingtalkUserId],
          msgKey: "sampleActionCard",
          msgParam: {
            title: message.title,
            text: message.markdown,
            singleTitle: message.link.label,
            singleURL: dingtalkInAppLink(message.link.url)
          }
        });
      } else {
        await this.sender.sendOneToOneMessage({
          userIds: [dingtalkUserId],
          msgKey: "sampleMarkdown",
          msgParam: { title: message.title, text: message.markdown }
        });
      }
      await this.db.notificationDelivery.updateMany({
        where: { id: { in: deliveryIds } },
        data: { status: "sent", deliveredAt: new Date() }
      });
      return "sent";
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn("dingtalk proactive push failed", { userId: input.userId, detail });
      await this.db.notificationDelivery
        .updateMany({ where: { id: { in: deliveryIds } }, data: { status: "failed", error: detail.slice(0, 1000) } })
        .catch(() => undefined);
      return "failed";
    }
  }
}
