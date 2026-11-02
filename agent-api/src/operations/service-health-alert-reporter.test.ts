import { describe, expect, it, vi } from "vitest";

import {
  ServiceHealthAlertReporter,
  buildServiceHealthAlertMessage,
  serviceHealthAlertSchema
} from "./service-health-alert-reporter.js";

function createReporter(input: { superAdmins?: string[]; sendError?: Error } = {}) {
  const notifications = {
    create: vi.fn(async () => ({ id: "notice-1" })),
    update: vi.fn(async () => undefined)
  };
  const sendWorkNotice = vi.fn(async (_input: { userIds?: string[]; message: string }) => {
    if (input.sendError) throw input.sendError;
  });
  const reporter = new ServiceHealthAlertReporter({
    notifications,
    sendWorkNotice,
    listSuperAdminDingTalkUserIds: async () => input.superAdmins ?? [],
    now: () => new Date("2026-11-02T05:09:00.000Z")
  });
  return { reporter, notifications, sendWorkNotice };
}

describe("ServiceHealthAlertReporter", () => {
  it("sends outage alerts to super admins and records the notification", async () => {
    const { reporter, notifications, sendWorkNotice } = createReporter({ superAdmins: ["ding-admin"] });
    const alert = serviceHealthAlertSchema.parse({
      event: "down",
      slot: "b",
      port: "8792",
      consecutiveFailures: "3",
      pm2Status: "stopped",
      downSince: "2026-11-02T03:34:00.000Z"
    });

    const result = await reporter.report(alert);

    expect(result).toEqual({ status: "sent", notificationId: "notice-1" });
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        channelType: "dingtalk",
        targetRef: "chat:b",
        eventType: "service_health_down",
        status: "pending",
        payload: expect.objectContaining({ recipientUserIds: ["ding-admin"], slot: "b" })
      })
    );
    const message = sendWorkNotice.mock.calls[0]?.[0];
    expect(message?.userIds).toEqual(["ding-admin"]);
    expect(message?.message).toContain("聊天服务");
    expect(message?.message).toContain("slot b（端口 8792）");
    expect(message?.message).toContain("连续检查失败：3 次");
    expect(notifications.update).toHaveBeenCalledWith({ id: "notice-1", changes: { status: "sent", errorMessage: null } });
  });

  it("falls back to the integration alert recipients when no super admin has DingTalk bound", async () => {
    const { reporter, sendWorkNotice } = createReporter();
    await reporter.report(serviceHealthAlertSchema.parse({ event: "test" }));
    expect(sendWorkNotice.mock.calls[0]?.[0]?.userIds).toBeUndefined();
  });

  it("marks the notification failed when DingTalk rejects it", async () => {
    const { reporter, notifications } = createReporter({ superAdmins: ["ding-admin"], sendError: new Error("agent not allowed") });
    const result = await reporter.report(serviceHealthAlertSchema.parse({ event: "restart_failed", slot: "a" }));
    expect(result).toMatchObject({ status: "failed", detail: "agent not allowed" });
    expect(notifications.update).toHaveBeenCalledWith({
      id: "notice-1",
      changes: { status: "failed", errorMessage: "agent not allowed" }
    });
  });

  it("states how long users were affected once the service is back", () => {
    const message = buildServiceHealthAlertMessage(
      serviceHealthAlertSchema.parse({ event: "restarted", slot: "b", downSince: "2026-11-02T03:34:00.000Z" }),
      new Date("2026-11-02T05:09:00.000Z")
    );
    expect(message.split("\n")[0]).toBe("【已恢复】服务已自动重启并恢复：聊天服务");
    expect(message).toContain("影响时长：约 1 小时 35 分钟");
  });

  it("rejects unknown events", () => {
    expect(serviceHealthAlertSchema.safeParse({ event: "reboot" }).success).toBe(false);
  });
});
