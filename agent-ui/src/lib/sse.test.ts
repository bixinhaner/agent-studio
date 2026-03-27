import { describe, expect, it, vi } from "vitest";

import { AUTH_INVALID_EVENT } from "./api";
import { iterateSSE } from "./sse";

describe("iterateSSE", () => {
  it("dispatches auth invalid when the stream request is unauthorized", async () => {
    const handler = vi.fn();
    window.addEventListener(AUTH_INVALID_EVENT, handler);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        body: null
      })
    );

    await expect((async () => {
      for await (const _event of iterateSSE("/api/chat/stream", {})) {
        // noop
      }
    })()).rejects.toThrow(/401/);

    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ status: 401 });

    window.removeEventListener(AUTH_INVALID_EVENT, handler);
  });
});
