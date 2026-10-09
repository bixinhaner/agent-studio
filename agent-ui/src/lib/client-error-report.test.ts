import { afterEach, describe, expect, it, vi } from "vitest";

import { buildClientErrorReportBody, reportClientError } from "./client-error-report";

describe("client error report", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the error, component stack and thread without the URL query", () => {
    window.history.replaceState(null, "", "/?view=workspace&thread=secret-thread");
    const error = new Error("Minified React error #310");

    const body = buildClientErrorReportBody({
      source: "portal-thread",
      error,
      componentStack: "\n    in ProcessDataPart",
      threadId: "thread-1",
      locale: "zh-CN"
    });

    expect(body).toEqual(expect.objectContaining({
      source: "portal-thread",
      name: "Error",
      message: "Minified React error #310",
      component_stack: "in ProcessDataPart",
      thread_id: "thread-1",
      locale: "zh-CN",
      url_path: "/"
    }));
    expect(String(body.stack)).toContain("Minified React error #310");
  });

  it("posts best-effort and never throws when the request fails", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("offline");
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(() => reportClientError({ source: "portal-thread", error: "boom" })).not.toThrow();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/client-errors$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(expect.objectContaining({ message: "boom" }));
  });
});
