import { describe, expect, it, vi } from "vitest";

import { FakeOperationsDb } from "../persistence/operations-test-helpers.js";
import { AlertEventRepository } from "../persistence/alert-event-repository.js";
import { NotificationRecordRepository } from "../persistence/notification-record-repository.js";
import { NotificationDispatchService } from "./notification-dispatch-service.js";

describe("NotificationDispatchService", () => {
  it("persists a DingTalk notification delivery record even when sending fails", async () => {
    const db = new FakeOperationsDb() as never;
    const notifications = new NotificationRecordRepository(db);
    const service = new NotificationDispatchService({
      notifications,
      dingtalk: vi.fn().mockRejectedValue(new Error("DingTalk unavailable"))
    });
    const alertEvent = await new AlertEventRepository(db).create({
      organizationId: "org-1",
      scopeType: "department",
      scopeId: "dept-rd",
      severity: "warning",
      status: "open",
      title: "Quota threshold exceeded",
      detail: "Internal cost reached 120.000000 against 100.000000",
      payload: { metricType: "internal_cost" }
    });

    await service.dispatchAlert(alertEvent);

    expect(await notifications.list({ targetRef: alertEvent.id, channelType: "dingtalk" })).toContainEqual(
      expect.objectContaining({
        channelType: "dingtalk",
        status: "failed"
      })
    );
    expect(await notifications.list({ targetRef: alertEvent.id, channelType: "in_app" })).toContainEqual(
      expect.objectContaining({
        channelType: "in_app",
        status: "delivered"
      })
    );
  });
});
