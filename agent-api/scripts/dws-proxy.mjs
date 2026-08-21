#!/usr/bin/env node

const baseUrl = (process.env.AGENT_STUDIO_BASE_URL || "").replace(/\/+$/, "");
const token = process.env.AGENT_STUDIO_DWS_PROXY_TOKEN || "";

if (!baseUrl || !token) {
  process.stderr.write("DWS runtime is not configured for this Agent Studio session.\n");
  process.exit(1);
}

const abortController = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => abortController.abort());
}

try {
  const response = await fetch(`${baseUrl}/api/integrations/dingtalk/dws/exec`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ args: process.argv.slice(2) }),
    signal: abortController.signal
  });
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => undefined);
    process.stderr.write(`${payload?.detail || `DWS runtime HTTP ${response.status}`}\n`);
    process.exitCode = 1;
  } else {
    const decoder = new TextDecoder();
    let buffer = "";
    let exitCode = 1;
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let lineEnd = buffer.indexOf("\n");
      while (lineEnd >= 0) {
        const line = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);
        if (line) {
          const event = JSON.parse(line);
          if (event.stream === "stdout" && typeof event.data === "string") process.stdout.write(event.data);
          if (event.stream === "stderr" && typeof event.data === "string") process.stderr.write(event.data);
          if (event.stream === "exit" && Number.isInteger(event.code)) exitCode = event.code;
        }
        lineEnd = buffer.indexOf("\n");
      }
    }
    process.exitCode = exitCode;
  }
} catch (error) {
  if (abortController.signal.aborted) {
    process.exitCode = 130;
  } else {
    process.stderr.write(`${error instanceof Error ? error.message : "DWS runtime request failed"}\n`);
    process.exitCode = 1;
  }
}
