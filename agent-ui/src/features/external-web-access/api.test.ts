// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EXTERNAL_WEB_MAINTENANCE_EVENT,
  EXTERNAL_WEB_MAINTENANCE_MESSAGE,
  api
} from "../../lib/api";
import { fetchPublicExternalWebAccessState } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("external Web access API", () => {
  it("reads the public maintenance state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ maintenance_enabled: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
    );

    await expect(fetchPublicExternalWebAccessState()).resolves.toEqual({
      maintenanceEnabled: true
    });
  });

  it("notifies the active Portal when the backend closes external Web access", async () => {
    const listener = vi.fn();
    window.addEventListener(EXTERNAL_WEB_MAINTENANCE_EVENT, listener);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ detail: EXTERNAL_WEB_MAINTENANCE_MESSAGE }), {
          status: 503,
          headers: { "Content-Type": "application/json" }
        })
      )
    );

    await expect(api("/api/portal/threads")).rejects.toThrow(EXTERNAL_WEB_MAINTENANCE_MESSAGE);
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(EXTERNAL_WEB_MAINTENANCE_EVENT, listener);
  });
});
