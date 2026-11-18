import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PortalI18nProvider } from "../i18n";
import { UsageDrawer } from "./UsageDrawer";

const people = Array.from({ length: 55 }, (_, index) => ({
  rank: index + 1,
  user_id: index === 1 ? "lead-report" : index === 52 ? "me" : null,
  name: index === 52 ? "Me Myself" : `Person ${index + 1}`,
  department: index % 2 ? "Sales" : "Engineering",
  total_tokens: 10_000_000 - index * 1000,
  turns: 10,
  self: index === 52
}));

const company = {
  period: "month",
  timezone: "Asia/Shanghai",
  totals: { members: 70, active_members: 55, total_tokens: 500_000_000, turns: 550 },
  departments: [
    { id: "sales", name: "Sales", members: 30, active_members: 25, total_tokens: 300_000_000, turns: 300, led: false, mine: false },
    { id: "eng", name: "Engineering", members: 40, active_members: 30, total_tokens: 200_000_000, turns: 250, led: true, mine: true }
  ],
  people,
  inactive_members: 15,
  team: { available: true, size: 12 }
};

const api = vi.hoisted(() => ({
  fetchCompanyUsage: vi.fn(),
  fetchUsageRanking: vi.fn(),
  fetchPersonalUsage: vi.fn(),
  fetchTeamUsage: vi.fn(),
  fetchTeamMemberUsage: vi.fn()
}));
vi.mock("./api", () => api);

beforeEach(() => {
  window.localStorage.setItem("agent-studio.portal.locale.v1", "en");
  api.fetchCompanyUsage.mockResolvedValue(company);
  api.fetchUsageRanking.mockResolvedValue({
    period: "month",
    timezone: "Asia/Shanghai",
    total_tokens: 1,
    department: null,
    company: { rank: 53, size: 70, active: 55 },
    team: { available: false, size: 0 }
  });
  api.fetchPersonalUsage.mockReturnValue(new Promise(() => undefined));
  api.fetchTeamUsage.mockReturnValue(new Promise(() => undefined));
  api.fetchTeamMemberUsage.mockReturnValue(new Promise(() => undefined));
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
});

async function openCompany() {
  render(
    <PortalI18nProvider>
      <UsageDrawer open onClose={vi.fn()} />
    </PortalI18nProvider>
  );
  // Every employee gets the company tab, even without a team of their own.
  fireEvent.click(await screen.findByText("Company (70)"));
  await screen.findByText("Ranking (55)");
}

describe("UsageDrawer company view", () => {
  it("ranks everyone who used it but only lets the viewer open rows they may see", async () => {
    await openCompany();
    expect(screen.getByText("Tokens depend on conversation length and context size, so they only reflect how much Bailey was used.")).toBeTruthy();
    expect(screen.getByText("15 more people didn't use Bailey in this period")).toBeTruthy();

    // Other departments and people are plain rows, not buttons.
    expect(screen.getByText("Sales", { selector: ".usage-team-label" }).closest("button")).toBeNull();
    expect(screen.getByText("Person 1").closest("button")).toBeNull();
    expect(screen.getByText("Engineering", { selector: ".usage-team-label" }).closest("button")).not.toBeNull();
    expect(screen.getByText("Person 2").closest("button")).not.toBeNull();
    expect(screen.queryByText(/last used/)).toBeNull();

    // First 50 rows, the viewer pinned below, then "show more".
    expect(screen.queryByText("Person 51")).toBeNull();
    const pinned = screen.getByText("Me Myself").closest("li")!;
    expect(pinned.className).toContain("usage-team-pinned");
    fireEvent.click(screen.getByRole("button", { name: "Show more (5 left)" }));
    expect(screen.getByText("Person 55")).toBeTruthy();
    expect(screen.getAllByText("Me Myself")).toHaveLength(1);
  });

  it("opens a led department into the team view and back to the company", async () => {
    api.fetchTeamUsage.mockResolvedValue({
      period: "month",
      timezone: "Asia/Shanghai",
      totals: { members: 1, active_members: 1, total_tokens: 10, turns: 1, tasks: 1 },
      members: [],
      departments: [
        { id: "eng", name: "Engineering", parent_id: null, member_ids: [], secondary_ids: [], members: 1, active_members: 1, total_tokens: 10, turns: 1, tasks: 1 }
      ]
    });
    await openCompany();
    fireEvent.click(screen.getByText("Engineering", { selector: ".usage-team-label" }).closest("button")!);
    await waitFor(() => expect(api.fetchTeamUsage).toHaveBeenCalled());
    const trail = await screen.findByRole("navigation");
    // Opens focused on the led department.
    expect(within(trail).getByRole("button", { name: "Engineering" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(within(trail).getByRole("button", { name: "Company" }));
    await screen.findByText("Ranking (55)");
  });

  it("opens an in-scope person's details with a plain back button", async () => {
    await openCompany();
    fireEvent.click(screen.getByText("Person 2").closest("button")!);
    await waitFor(() => expect(api.fetchTeamMemberUsage).toHaveBeenCalledWith("lead-report", "month", expect.any(String)));
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
  });
});
