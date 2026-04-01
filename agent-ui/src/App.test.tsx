import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./features/auth/api", () => ({
  fetchWhoAmI: vi.fn()
}));

vi.mock("./features/admin/AdminShell", () => ({
  AdminShell: (props: { onOpenPortal?: () => void; onSignOut?: () => void }) => (
    <div>
      <div>admin-shell</div>
      <button type="button" onClick={() => props.onOpenPortal?.()}>
        to-portal
      </button>
      <button type="button" onClick={() => props.onSignOut?.()}>
        sign-out
      </button>
    </div>
  )
}));

vi.mock("./features/portal/PortalShell", () => ({
  PortalShell: (props: { onOpenAdmin?: () => void; onSignOut?: () => void }) => (
    <div>
      <div>portal-shell</div>
      <button type="button" onClick={() => props.onOpenAdmin?.()}>
        to-admin
      </button>
      <button type="button" onClick={() => props.onSignOut?.()}>
        sign-out
      </button>
    </div>
  )
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

  it("shows the portal shell for admin users by default", async () => {
    mockedFetchWhoAmI.mockResolvedValueOnce({
      user: {
        id: "admin-1",
        role: "admin"
      }
    });

    render(<App />);

    expect(await screen.findByText("portal-shell")).toBeTruthy();
  });

  it("lets admin users switch from the portal shell into the admin shell", async () => {
    mockedFetchWhoAmI.mockResolvedValueOnce({
      user: {
        id: "admin-1",
        role: "admin"
      }
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "to-admin" }));
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
