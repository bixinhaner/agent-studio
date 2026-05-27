const baseUrl = (process.env.AGENT_STUDIO_BASE_URL || "").replace(/\/+$/, "");
const token = process.env.AGENT_STUDIO_CREST_PROXY_TOKEN || "";

let buffer = Buffer.alloc(0);

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
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) return;
    const header = buffer.slice(0, headerEnd).toString("utf8");
    const match = header.match(/content-length:\s*(\d+)/i);
    if (!match) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }
    const length = Number.parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd) return;
    const body = buffer.slice(bodyStart, bodyEnd).toString("utf8");
    buffer = buffer.slice(bodyEnd);
    await handleMessage(body);
  }
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
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`);
}
