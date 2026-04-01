import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", () => ({
  api: vi.fn()
}));

import { api } from "../../lib/api";
import { createDingTalkSession, fetchWhoAmI } from "./api";

const mockedApi = vi.mocked(api);

describe("auth api", () => {
  beforeEach(() => {
    mockedApi.mockReset();
  });

  it("normalizes snake_case whoami user fields into the frontend auth shape", async () => {
    mockedApi.mockResolvedValueOnce({
      user: {
        id: "user-1",
        role: "super_admin",
        external_id: "ding-union-1",
        display_name: "Like李可15686172592",
        email: "like@baicells.com",
        status: "active"
      }
    });

    await expect(fetchWhoAmI()).resolves.toEqual({
      user: {
        id: "user-1",
        role: "super_admin",
        externalId: "ding-union-1",
        displayName: "Like李可15686172592",
        email: "like@baicells.com",
        status: "active"
      }
    });
  });

  it("normalizes snake_case DingTalk session user fields after login", async () => {
    mockedApi.mockResolvedValueOnce({
      user: {
        id: "user-2",
        role: "employee",
        external_id: "ding-union-2",
        display_name: "Recovered User",
        email: "recovered@example.com",
        status: "active"
      }
    });

    await expect(
      createDingTalkSession({
        code: "auth-code",
        state: "oauth-state",
        nonce: "nonce-1"
      })
    ).resolves.toEqual({
      user: {
        id: "user-2",
        role: "employee",
        externalId: "ding-union-2",
        displayName: "Recovered User",
        email: "recovered@example.com",
        status: "active"
      }
    });
  });
});
