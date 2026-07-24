import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchPublicThreadShare } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("public share API", () => {
  it("sends the employee session cookie when reading a protected link", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          share: {
            id: "share-1",
            token: "token-1",
            title: "Shared conversation",
            public_path: "/share/token-1",
            selected_turn_count: 1,
            snapshot: { version: 1, turns: [] },
            expires_at: "2026-07-31T00:00:00.000Z",
            created_at: "2026-07-24T00:00:00.000Z",
            updated_at: "2026-07-24T00:00:00.000Z"
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchPublicThreadShare("token-1");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/public-api/thread-shares/token-1"),
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("preserves the HTTP status for sign-in and access guidance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ detail: "Unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" }
        })
      )
    );

    await expect(fetchPublicThreadShare("token-1")).rejects.toMatchObject({
      name: "PublicShareAccessError",
      message: "Unauthorized",
      status: 401
    });
  });
});
