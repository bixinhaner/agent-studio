import { z } from "zod";

type Logger = Pick<Console, "warn">;

type NotificationStore = {
  create(input: {
    organizationId?: string;
    channelType: "dingtalk";
    targetRef: string;
    eventType: string;
    status: "pending";
    payload: Record<string, unknown>;
  }): Promise<{ id: string }>;
  update(input: { id: string; changes: { status: "sent" | "failed"; errorMessage: string | null } }): Promise<unknown>;
};

/** What the chat watchdog (scripts/shared-runtime/chat-watchdog.sh) observed. */
export const serviceHealthAlertSchema = z.object({
  service: z.string().trim().min(1).max(64).default("chat"),
  event: z.enum(["down", "restarted", "restart_failed", "recovered", "test"]),
  slot: z.string().trim().max(8).optional(),
  port: z.coerce.number().int().positive().optional(),
  consecutiveFailures: z.coerce.number().int().nonnegative().optional(),
  downSince: z.string().trim().max(64).optional(),
  pm2Status: z.string().trim().max(32).optional(),
  detail: z.string().trim().max(1000).optional(),
  host: z.string().trim().max(128).optional()
});

export type ServiceHealthAlert = z.infer<typeof serviceHealthAlertSchema>;

const SERVICE_LABELS: Record<string, string> = {
  chat: "聊天服务"
};

const EVENT_TITLES: Record<ServiceHealthAlert["event"], string> = {
  down: "【告警】服务无响应，正在自动重启",
  restarted: "【已恢复】服务已自动重启并恢复",
  restart_failed: "【告警】服务自动重启失败，需要人工处理",
  recovered: "【已恢复】服务已恢复响应",
  test: "【测试】服务巡检告警通道测试"
};

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "不到 1 分钟";
  if (minutes < 60) return `约 ${minutes} 分钟`;
  return `约 ${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}

export function buildServiceHealthAlertMessage(alert: ServiceHealthAlert, now = new Date()): string {
  const service = SERVICE_LABELS[alert.service] ?? alert.service;
  const downSince = alert.downSince ? new Date(alert.downSince) : undefined;
  const validDownSince = downSince && !Number.isNaN(downSince.getTime()) ? downSince : undefined;
  const lines = [
    `${EVENT_TITLES[alert.event]}：${service}`,
    "",
    alert.slot ? `实例：slot ${alert.slot}${alert.port ? `（端口 ${alert.port}）` : ""}` : "",
    alert.host ? `服务器：${alert.host}` : "",
    alert.consecutiveFailures ? `连续检查失败：${alert.consecutiveFailures} 次` : "",
    alert.pm2Status ? `PM2 状态：${alert.pm2Status}` : "",
    validDownSince ? `开始无响应：${validDownSince.toISOString()}` : "",
    validDownSince && (alert.event === "restarted" || alert.event === "recovered")
      ? `影响时长：${formatDuration(now.getTime() - validDownSince.getTime())}`
      : "",
    alert.detail ? `详情：${alert.detail}` : "",
    alert.event === "down" ? "期间用户可能无法打开对话或发送消息。" : "",
    alert.event === "restart_failed"
      ? "请登录服务器查看 pm2 logs 和 releases/state/chat.slot，巡检会继续定期重试。"
      : ""
  ];
  return lines.filter((line, index) => line || index === 1).join("\n");
}

/** Sends chat watchdog alerts to super admins over the same DingTalk work notice as other operations alerts. */
export class ServiceHealthAlertReporter {
  constructor(
    private readonly deps: {
      notifications: NotificationStore;
      sendWorkNotice(input: { userIds?: string[]; message: string }): Promise<void>;
      listSuperAdminDingTalkUserIds(): Promise<string[]>;
      logger?: Logger;
      now?: () => Date;
    }
  ) {}

  async report(alert: ServiceHealthAlert): Promise<{ status: "sent" | "failed"; notificationId: string; detail?: string }> {
    const recipientUserIds = await this.deps.listSuperAdminDingTalkUserIds().catch(() => []);
    const message = buildServiceHealthAlertMessage(alert, this.deps.now?.() ?? new Date());
    const notification = await this.deps.notifications.create({
      channelType: "dingtalk",
      targetRef: `${alert.service}:${alert.slot ?? "-"}`,
      eventType: `service_health_${alert.event}`,
      status: "pending",
      payload: { ...alert, recipientUserIds }
    });
    try {
      // No super admin with DingTalk bound: fall back to the integration's alert recipients.
      await this.deps.sendWorkNotice({
        userIds: recipientUserIds.length ? recipientUserIds : undefined,
        message
      });
      await this.deps.notifications.update({ id: notification.id, changes: { status: "sent", errorMessage: null } });
      return { status: "sent", notificationId: notification.id };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "DingTalk notification failed";
      await this.deps.notifications.update({ id: notification.id, changes: { status: "failed", errorMessage: detail } });
      this.deps.logger?.warn("service health alert notification failed", { notificationId: notification.id, detail });
      return { status: "failed", notificationId: notification.id, detail };
    }
  }
}
