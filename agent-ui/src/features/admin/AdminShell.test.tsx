import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: vi.fn()
  };
});

vi.mock("../auth/api", () => ({
  fetchWhoAmI: vi.fn()
}));

import App from "../../App";
import { fetchWhoAmI } from "../auth/api";
import { api } from "../../lib/api";
import { AdminShell } from "./AdminShell";

const mockedApi = vi.mocked(api);
const mockedFetchWhoAmI = vi.mocked(fetchWhoAmI);

describe("AdminShell", () => {
  beforeEach(() => {
    mockedApi.mockReset();
    mockedFetchWhoAmI.mockReset();
  });

  it("loads and renders the admin overview", async () => {
    mockedApi.mockResolvedValueOnce({
      counts: {
        users: 7,
        threads: 13,
        activeSessions: 3
      }
    });

    render(<AdminShell />);

    expect(await screen.findByText("管理控制台")).toBeTruthy();
    expect(await screen.findByText("7")).toBeTruthy();
    expect(screen.getByText("13")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("routes super admins into the real admin shell", async () => {
    mockedFetchWhoAmI.mockResolvedValueOnce({
      user: {
        id: "root-1",
        role: "super_admin"
      }
    });
    mockedApi.mockResolvedValueOnce({
      counts: {
        users: 2,
        threads: 5,
        activeSessions: 1
      }
    });

    render(<App />);

    expect(await screen.findByText("管理控制台")).toBeTruthy();
    expect(mockedApi).toHaveBeenCalledWith("/api/admin/overview");
  });
});
