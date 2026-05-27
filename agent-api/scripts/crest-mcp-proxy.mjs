const baseUrl = (process.env.AGENT_STUDIO_BASE_URL || "").replace(/\/+$/, "");
const token = process.env.AGENT_STUDIO_CREST_PROXY_TOKEN || "";

let buffer = Buffer.alloc(0);
let outputFraming = "content-length";

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
  drainFrames().catch((error) => {
    writeError(null, error instanceof Error ? error.message : "Crest MCP proxy failed");
  });
});

process.stdin.on("end", () => {
  process.exit(0);
});

async function drainFrames() {
  while (true) {
    const frame = readFrame();
    if (!frame) return;
    outputFraming = frame.framing;
    await handleMessage(frame.body);
  }
}

function readFrame() {
  const first = firstNonWhitespaceIndex(buffer);
  if (first > 0) {
    buffer = buffer.slice(first);
  }
  if (!buffer.length) return undefined;

  const headerBoundary = findHeaderBoundary(buffer);
  const startsWithJson = buffer[0] === 0x7b;
  if (startsWithJson && headerBoundary < 0) {
    const lineEnd = buffer.indexOf("\n");
    if (lineEnd < 0) return undefined;
    const body = buffer.slice(0, lineEnd).toString("utf8").trim();
    buffer = buffer.slice(lineEnd + 1);
    return body ? { body, framing: "newline" } : undefined;
  }

  if (headerBoundary < 0) return undefined;
  const header = buffer.slice(0, headerBoundary.index).toString("utf8");
  const match = header.match(/content-length:\s*(\d+)/i);
  if (!match) {
    buffer = buffer.slice(headerBoundary.index + headerBoundary.length);
    return undefined;
  }
  const length = Number.parseInt(match[1], 10);
  const bodyStart = headerBoundary.index + headerBoundary.length;
  const bodyEnd = bodyStart + length;
  if (buffer.length < bodyEnd) return undefined;
  const body = buffer.slice(bodyStart, bodyEnd).toString("utf8");
  buffer = buffer.slice(bodyEnd);
  return { body, framing: "content-length" };
}

function findHeaderBoundary(value) {
  const crlf = value.indexOf("\r\n\r\n");
  if (crlf >= 0) return { index: crlf, length: 4 };
  const lf = value.indexOf("\n\n");
  return lf >= 0 ? { index: lf, length: 2 } : -1;
}

function firstNonWhitespaceIndex(value) {
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== 0x20 && char !== 0x09 && char !== 0x0a && char !== 0x0d) {
      return index;
    }
  }
  return value.length;
}

async function handleMessage(body) {
  let message;
  try {
    message = JSON.parse(body);
  } catch {
    writeError(null, "Invalid JSON-RPC payload");
    return;
  }

  if (message?.method === "notifications/initialized" || message?.id === undefined) {
    return;
  }
  if (!baseUrl || !token) {
    writeError(message.id ?? null, "Crest MCP proxy is not configured");
    return;
  }

  try {
    const response = await fetch(`${baseUrl}/api/integrations/crest/mcp/rpc`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ rpc: message })
    });
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) {
      writeError(message.id ?? null, payload?.detail || `Crest MCP proxy HTTP ${response.status}`);
      return;
    }
    writeFrame(payload);
  } catch (error) {
    writeError(message.id ?? null, error instanceof Error ? error.message : "Crest MCP proxy request failed");
  }
}

function writeError(id, message) {
  writeFrame({
    jsonrpc: "2.0",
    id,
    error: { code: -32603, message }
  });
}

function writeFrame(payload) {
  const json = JSON.stringify(payload);
  if (outputFraming === "newline") {
    process.stdout.write(`${json}\n`);
    return;
  }
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`);
}
