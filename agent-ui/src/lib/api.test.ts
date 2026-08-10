import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api request content type", () => {
  it("lets the browser add the multipart boundary for FormData", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    ));
    vi.stubGlobal("fetch", fetchMock);
    const formData = new FormData();
    formData.set("payload", "{}");

    await api("/api/admin/product-feedback/feedback-1/reply-preview", {
      method: "POST",
      body: formData
    });

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.has("Content-Type")).toBe(false);
  });

  it("sets JSON content type for structured requests", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    ));
    vi.stubGlobal("fetch", fetchMock);

    await api("/api/test", { method: "POST", json: { ok: true } });

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get("Content-Type")).toBe("application/json");
  });
});
