import { describe, expect, it, vi } from "vitest";

import { api } from "../../lib/api";
import {
  acknowledgeAlertEvent,
  createQuotaPolicy,
  fetchAlertEvents,
  fetchCostProfiles,
  fetchMonitoringOverview,
  fetchMonitoringRankings,
  fetchMonitoringTrends,
  fetchNotificationRecords,
  fetchQuotaPolicies,
  fetchResourceAccessLogs,
  fetchUsageEvents,
  updateCostProfile
} from "./api";

vi.mock("../../lib/api", () => ({
  api: vi.fn()
}));

const mockedApi = vi.mocked(api);

describe("monitoring api", () => {
  it("calls monitoring endpoints with typed helpers", async () => {
    mockedApi
      .mockResolvedValueOnce({ overview: { totalRequests: 1 }, trends: [] })
      .mockResolvedValueOnce({ rankings: { topUsers: [] } })
      .mockResolvedValueOnce({ trends: [] })
      .mockResolvedValueOnce({ resourceAccessLogs: [] })
      .mockResolvedValueOnce({ usageEvents: [] })
      .mockResolvedValueOnce({ quotaPolicies: [] })
      .mockResolvedValueOnce({ alertEvents: [] })
      .mockResolvedValueOnce({ notificationRecords: [] })
      .mockResolvedValueOnce({ costProfiles: [] })
      .mockResolvedValueOnce({ quotaPolicy: { id: "policy-1" } })
      .mockResolvedValueOnce({ costProfile: { id: "profile-1" } })
      .mockResolvedValueOnce({ alertEvent: { id: "alert-1" } });

    await fetchMonitoringOverview();
    await fetchMonitoringRankings();
    await fetchMonitoringTrends();
    await fetchResourceAccessLogs();
    await fetchUsageEvents();
    await fetchQuotaPolicies();
    await fetchAlertEvents();
    await fetchNotificationRecords();
    await fetchCostProfiles();
    await createQuotaPolicy({
      scopeType: "department",
      scopeId: "dept-rd",
      featureType: "chat",
      metricType: "internal_cost",
      thresholdValue: "10"
    });
    await updateCostProfile("profile-1", { outputTokenPrice: "0.031000" });
    await acknowledgeAlertEvent("alert-1");

    expect(mockedApi).toHaveBeenNthCalledWith(1, "/api/admin/monitoring/overview");
    expect(mockedApi).toHaveBeenNthCalledWith(2, "/api/admin/monitoring/rankings");
    expect(mockedApi).toHaveBeenNthCalledWith(3, "/api/admin/monitoring/trends");
    expect(mockedApi).toHaveBeenNthCalledWith(4, "/api/admin/monitoring/resource-access-logs");
    expect(mockedApi).toHaveBeenNthCalledWith(5, "/api/admin/monitoring/usage-events");
    expect(mockedApi).toHaveBeenNthCalledWith(6, "/api/admin/quota-policies");
    expect(mockedApi).toHaveBeenNthCalledWith(7, "/api/admin/alert-events");
    expect(mockedApi).toHaveBeenNthCalledWith(8, "/api/admin/notification-records");
    expect(mockedApi).toHaveBeenNthCalledWith(9, "/api/admin/cost-profiles");
    expect(mockedApi).toHaveBeenNthCalledWith(10, "/api/admin/quota-policies", expect.objectContaining({ method: "POST" }));
    expect(mockedApi).toHaveBeenNthCalledWith(11, "/api/admin/cost-profiles/profile-1", expect.objectContaining({ method: "PATCH" }));
    expect(mockedApi).toHaveBeenNthCalledWith(12, "/api/admin/alert-events/alert-1/acknowledge", expect.objectContaining({ method: "POST" }));
  });
});
