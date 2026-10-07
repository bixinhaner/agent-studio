import { GATEWAY_RETRY_STATUSES, notifyAuthInvalidStatus, waitForRetry } from "./api";

type SSEEvent = {
  event: string;
  data: unknown;
};

type SSEOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  credentials?: RequestCredentials;
  signal?: AbortSignal;
  onEvent: (event: SSEEvent) => void;
};

type SSEIterateOptions = Omit<SSEOptions, "onEvent">;

function decodeLines(buffer: string): { events: string[]; rest: string } {
  const chunks = buffer.split("\n\n");
  if (chunks.length <= 1) return { events: [], rest: buffer };
  const rest = chunks.pop() || "";
  return { events: chunks, rest };
}

// A gateway 502/503/504 means the request never reached a chat instance (for
// example during a chat slot switch), so starting the stream again is safe.
// Network errors are not retried: the server may already be running the turn.
const STREAM_START_RETRY_DELAYS_MS = [1000, 2000];

async function openSSE(url: string, options: SSEIterateOptions): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(url, {
      method: options.method || "GET",
      headers: options.headers,
      body: options.body,
      credentials: options.credentials ?? "include",
      signal: options.signal
    });
    if (!GATEWAY_RETRY_STATUSES.has(res.status) || attempt >= STREAM_START_RETRY_DELAYS_MS.length) return res;
    await res.body?.cancel().catch(() => undefined);
    await waitForRetry(STREAM_START_RETRY_DELAYS_MS[attempt], options.signal);
  }
}

export async function* iterateSSE(url: string, options: SSEIterateOptions): AsyncGenerator<SSEEvent> {
  const res = await openSSE(url, options);
  if (!res.ok || !res.body) {
    notifyAuthInvalidStatus(res.status);
    throw new Error(`SSE request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    const { events, rest } = decodeLines(buf);
    buf = rest;

    for (const raw of events) {
      const lines = raw.split("\n");
      let eventName = "message";
      const dataLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim() || "message";
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      }
      const dataRaw = dataLines.join("\n");
      let payload: unknown = dataRaw;
      try {
        payload = dataRaw ? JSON.parse(dataRaw) : null;
      } catch {
        payload = dataRaw;
      }
      yield { event: eventName, data: payload };
    }
  }
}

export async function streamSSE(url: string, options: SSEOptions): Promise<void> {
  for await (const event of iterateSSE(url, options)) {
    options.onEvent(event);
  }
}
