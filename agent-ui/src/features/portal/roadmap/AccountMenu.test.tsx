import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PortalI18nProvider } from "../i18n";
import { AccountMenu } from "./AccountMenu";

const roadmap = {
  personalFeaturesEnabled: true,
  usageEnabled: true,
  tourEnabled: true,
  openUsage: vi.fn(),
  openMemory: vi.fn(),
  openNotificationSettings: vi.fn(),
  startTour: vi.fn(),
  theme: { preference: "light", setPreference: vi.fn() }
};

vi.mock("./PortalRoadmapContext", () => ({ usePortalRoadmap: () => roadmap }));
vi.mock("../../auth/AuthProvider", () => ({
  useAuth: () => ({ activeOrganization: { id: "o1", name: "Baicells" }, memberships: [], selectOrganization: vi.fn() })
}));
vi.mock("./api", () => ({
  fetchPersonalUsage: vi.fn(async () => ({ totals: { total_tokens: 1_234_567 } }))
}));

beforeEach(() => {
  window.localStorage.setItem("agent-studio.portal.locale.v1", "en");
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
});

const user = { id: "u1", displayName: "Like", email: "like@example.com", role: "member", userType: "internal" } as never;

describe("AccountMenu", () => {
  it("shows this month's tokens on the card and opens personal views", async () => {
    const onSignOut = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <PortalI18nProvider>
        <AccountMenu user={user} onSignOut={onSignOut} />
      </PortalI18nProvider>
    );

    const card = screen.getByRole("button", { name: /account/i });
    await waitFor(() => expect(card.textContent).toContain("1.2M"));

    fireEvent.click(card);
    fireEvent.click(await screen.findByRole("menuitem", { name: /usage/i }));
    expect(roadmap.openUsage).toHaveBeenCalledOnce();

    fireEvent.click(card);
    fireEvent.click(await screen.findByRole("menuitem", { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});
