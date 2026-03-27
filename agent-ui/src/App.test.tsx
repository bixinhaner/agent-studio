import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./features/auth/api", () => ({
  fetchWhoAmI: vi.fn()
}));

vi.mock("./features/admin/AdminShell", () => ({
  AdminShell: () => <div>admin-shell</div>
}));

vi.mock("./features/portal/PortalShell", () => ({
  PortalShell: () => <div>portal-shell</div>
}));

import App from "./App";
import { fetchWhoAmI } from "./features/auth/api";

const mockedFetchWhoAmI = vi.mocked(fetchWhoAmI);

describe("App routing", () => {
  beforeEach(() => {
    mockedFetchWhoAmI.mockReset();
  });

  it("shows sign-in when whoami returns 401", async () => {
    mockedFetchWhoAmI.mockRejectedValueOnce(new Error("Unauthorized"));

    render(<App />);

    expect(await screen.findByText(/登录/i)).toBeTruthy();
  });

  it("shows the admin shell for admin users", async () => {
    mockedFetchWhoAmI.mockResolvedValueOnce({
      user: {
        id: "admin-1",
        role: "admin"
      }
    });

    render(<App />);

    expect(await screen.findByText("admin-shell")).toBeTruthy();
  });

  it("shows the portal shell for employee users", async () => {
    mockedFetchWhoAmI.mockResolvedValueOnce({
      user: {
        id: "employee-1",
        role: "employee"
      }
    });

    render(<App />);

    expect(await screen.findByText("portal-shell")).toBeTruthy();
  });
});
