import { describe, expect, it } from "vitest";

import { FakeOperationsDb } from "./operations-test-helpers.js";
import { NotificationRecordRepository } from "./notification-record-repository.js";

describe("NotificationRecordRepository", () => {
  it("creates notification delivery records and filters by event", async () => {
    const repository = new NotificationRecordRepository(new FakeOperationsDb() as never);

    await repository.create({
      organizationId: "org-1",
      channelType: "dingtalk",
      targetRef: "alert-event-1",
      eventType: "alert_event",
      status: "pending",
      payload: { alertEventId: "alert-event-1" }
    });

    const rows = await repository.list({
      organizationId: "org-1",
      channelType: "dingtalk",
      targetRef: "alert-event-1",
      eventType: "alert_event"
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("pending");
  });
});
