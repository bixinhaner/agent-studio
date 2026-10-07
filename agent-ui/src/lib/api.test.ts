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

describe("gateway retry during chat service switches", () => {
  it("retries reads on 502/503/504 and network errors, then returns the result", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi
        .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      const pending = api<{ ok: boolean }>("/api/threads/running");
      await vi.runAllTimersAsync();

      await expect(pending).resolves.toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never repeats writes", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ detail: "down" }), { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api("/api/chat/cancel", { method: "POST", json: {} })).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after a few attempts", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ detail: "down" }), { status: 503 }));
      vi.stubGlobal("fetch", fetchMock);

      const pending = api("/api/threads/running");
      const assertion = expect(pending).rejects.toMatchObject({ status: 503 });
      await vi.runAllTimersAsync();
      await assertion;
      expect(fetchMock).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });
});
