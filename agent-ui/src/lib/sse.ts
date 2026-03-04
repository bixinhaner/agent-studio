type SSEEvent = {
  event: string;
  data: unknown;
};

type SSEOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
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

export async function* iterateSSE(url: string, options: SSEIterateOptions): AsyncGenerator<SSEEvent> {
  const res = await fetch(url, {
    method: options.method || "GET",
    headers: options.headers,
    body: options.body,
    signal: options.signal
  });
  if (!res.ok || !res.body) {
    throw new Error(`SSE 请求失败(${res.status})`);
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
