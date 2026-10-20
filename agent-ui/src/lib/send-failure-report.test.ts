import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./api";
import { buildSendFailureReportBody, reportSendFailure } from "./send-failure-report";

describe("send failure report", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("carries the HTTP status, error code, text and attachments", () => {
    const body = buildSendFailureReportBody({
      stage: "message_save",
      threadId: "thread-1",
      error: new ApiError({ message: "Bad gateway", status: 502, detail: "upstream unavailable", code: "UPSTREAM" }),
      messagePreview: "这个是烽火的OLT",
      attachments: [{ name: "image.png", status: "requires-action", sizeBytes: 10 }],
      clientRunId: "run-1"
    });
    expect(body).toEqual(expect.objectContaining({
      stage: "message_save",
      thread_id: "thread-1",
      error_code: "UPSTREAM",
      http_status: 502,
      detail: "ApiError: upstream unavailable",
      message_preview: "这个是烽火的OLT",
      attachments: [{ name: "image.png", status: "requires-action", size_bytes: 10 }],
      client_run_id: "run-1"
    }));
  });

  it("posts best-effort to the admin endpoint and never throws", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("offline");
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(() => reportSendFailure({ stage: "thread_resolve", error: "no id" })).not.toThrow();
    await Promise.resolve();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/send-failures$/);
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(String(init.body))).toEqual(expect.objectContaining({ stage: "thread_resolve", detail: "no id" }));
  });

  it("adds the number of attempts of a retried send to the detail", () => {
    const body = buildSendFailureReportBody({
      stage: "chat_stream",
      error: new TypeError("Failed to fetch"),
      errorCode: "send_not_delivered",
      attempts: 4,
      clientRunId: "run-1"
    });
    expect(body).toMatchObject({ stage: "chat_stream", error_code: "send_not_delivered", client_run_id: "run-1" });
    expect(body.detail).toBe("TypeError: Failed to fetch | attempts=4");
  });
});
