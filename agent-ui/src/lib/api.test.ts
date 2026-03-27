import { describe, expect, it, vi } from "vitest";

import { AUTH_INVALID_EVENT, notifyAuthInvalidStatus } from "./api";

describe("notifyAuthInvalidStatus", () => {
  it("dispatches the auth invalid event only for 401", () => {
    const handler = vi.fn();
    window.addEventListener(AUTH_INVALID_EVENT, handler);

    notifyAuthInvalidStatus(401);
    notifyAuthInvalidStatus(403);
    notifyAuthInvalidStatus(500);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toBeInstanceOf(CustomEvent);
    expect((handler.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ status: 401 });

    window.removeEventListener(AUTH_INVALID_EVENT, handler);
  });
});
