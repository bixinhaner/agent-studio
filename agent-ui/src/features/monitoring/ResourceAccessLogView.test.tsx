import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  fetchResourceAccessLogs: vi.fn(),
  fetchUsageEvents: vi.fn()
}));

import { fetchResourceAccessLogs } from "./api";
import { ResourceAccessLogView } from "./ResourceAccessLogView";

const mockedFetchResourceAccessLogs = vi.mocked(fetchResourceAccessLogs);

describe("ResourceAccessLogView", () => {
  beforeEach(() => {
    mockedFetchResourceAccessLogs.mockReset();
  });

  it("renders access events with local time display", async () => {
    mockedFetchResourceAccessLogs.mockResolvedValue({
      resourceAccessLogs: [
        {
          id: "access-1",
          userId: "user-1",
          departmentIdSnapshot: "dept-rd",
          threadId: "thread-1",
          sessionId: "session-1",
          resourceType: "knowledge_set",
          resourceId: "ks-faq",
          actionType: "mount",
          resultStatus: "success",
          metadata: {},
          createdAt: "2026-03-29T08:00:00.000Z"
        }
      ]
    });

    render(<ResourceAccessLogView />);

    expect(await screen.findByText("资源访问日志")).toBeTruthy();
    expect(screen.getByText("knowledge_set")).toBeTruthy();
    expect(screen.getByText("mount")).toBeTruthy();
  });
});
