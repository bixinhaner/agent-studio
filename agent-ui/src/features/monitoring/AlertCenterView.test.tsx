import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  fetchAlertEvents: vi.fn(),
  fetchNotificationRecords: vi.fn()
}));

import { fetchAlertEvents, fetchNotificationRecords } from "./api";
import { AlertCenterView } from "./AlertCenterView";

const mockedFetchAlertEvents = vi.mocked(fetchAlertEvents);
const mockedFetchNotificationRecords = vi.mocked(fetchNotificationRecords);

describe("AlertCenterView", () => {
  beforeEach(() => {
    mockedFetchAlertEvents.mockReset();
    mockedFetchNotificationRecords.mockReset();
  });

  it("renders alert rows and notification delivery states", async () => {
    mockedFetchAlertEvents.mockResolvedValue({
      alertEvents: [
        {
          id: "alert-1",
          alertRuleId: "rule-1",
          severity: "critical",
          status: "open",
          title: "Quota exceeded",
          detail: "Department quota crossed",
          scopeType: "department",
          scopeId: "dept-rd",
          payload: {},
          createdAt: "2026-03-29T11:00:00.000Z"
        }
      ]
    });
    mockedFetchNotificationRecords.mockResolvedValue({
      notificationRecords: [
        {
          id: "notification-1",
          channelType: "dingtalk",
          targetRef: "dept-rd",
          eventType: "alert.event.created",
          status: "sent",
          payload: {},
          errorMessage: null,
          createdAt: "2026-03-29T11:00:05.000Z"
        }
      ]
    });

    render(<AlertCenterView />);

    expect(await screen.findByText("critical")).toBeTruthy();
    expect(screen.getByText("dingtalk")).toBeTruthy();
  });
});
