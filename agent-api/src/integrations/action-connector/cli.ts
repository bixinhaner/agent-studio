export function actionConnectorCliSource(): string {
  return `#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import fs from "node:fs";

const command = process.argv[2];
const args = process.argv.slice(3);

function required(value, name) {
  if (!value || !String(value).trim()) throw new Error(name + " is required");
  return String(value).trim();
}

function runtimeConfig() {
  const filePath = required(process.env.ACTION_CONNECTOR_RUNTIME_CONFIG, "ACTION_CONNECTOR_RUNTIME_CONFIG");
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseJsonArg(value, fallback) {
  if (!value || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error("Invalid JSON argument: " + error.message);
  }
}

function unwrap(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  if (Object.prototype.hasOwnProperty.call(payload, "ret")) {
    if (payload.ret === 1) return payload.data;
    throw new Error(typeof payload.msg === "string" ? payload.msg : "Connector request failed");
  }
  return payload;
}

async function readPayload(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function connectorBridgeUrl(config) {
  const baseUrl = required(config.bridgeBaseUrl, "bridgeBaseUrl").replace(/\\/+$/, "");
  const connectorId = encodeURIComponent(required(config.connectorId, "connectorId"));
  return baseUrl + "/api/action-connectors/" + connectorId + "/tool-requests";
}

async function submitToolRequest(input, toolCallId) {
  const config = runtimeConfig();
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Action-Connector-Bridge-Token": required(config.bridgeToken, "bridgeToken")
  };
  const response = await fetch(connectorBridgeUrl(config), {
    method: "POST",
    headers,
    body: JSON.stringify({
      runId: required(config.runId, "runId"),
      toolCallId: toolCallId || randomUUID(),
      input
    })
  });
  const payload = await readPayload(response);
  if (!response.ok) {
    const detail =
      payload && typeof payload === "object" && payload.error && typeof payload.error.message === "string"
        ? payload.error.message
        : "External tool bridge failed with HTTP " + response.status;
    throw new Error(detail);
  }
  if (payload && typeof payload === "object" && payload.status === "error") {
    const error = payload.error && typeof payload.error === "object" ? payload.error : {};
    throw new Error(typeof error.message === "string" ? error.message : "External tool request failed");
  }
  const output = unwrap(payload && typeof payload === "object" && "output" in payload ? payload.output : payload);
  const files = payload && typeof payload === "object" && Array.isArray(payload.files) ? payload.files : [];
  console.log(JSON.stringify(files.length ? { output, files } : output, null, 2));
}

try {
  const config = runtimeConfig();
  if (command === "identity") {
    console.log(JSON.stringify(config.identity || {}, null, 2));
  } else if (command === "catalog" || command === "list" || command === "search") {
    const query = command === "catalog" || command === "search" ? args.join(" ").trim() : "";
    await submitToolRequest({
      operationId: "get.agent.catalog",
      method: "GET",
      path: "/api/v1/agent/catalog",
      query: query ? { q: query } : {}
    });
  } else if (command === "describe") {
    await submitToolRequest({
      operationId: "get.agent.catalog.describe",
      method: "GET",
      path: "/api/v1/agent/catalog/describe",
      query: { operationId: required(args[0], "operationId") }
    });
  } else if (command === "request") {
    const method = required(args[0], "method").toUpperCase();
    const requestPath = required(args[1], "path");
    const input = parseJsonArg(args[2], {});
    await submitToolRequest({
      operationId: typeof input.operationId === "string" ? input.operationId : undefined,
      method,
      path: requestPath,
      query: input.query && typeof input.query === "object" ? input.query : undefined,
      body: Object.prototype.hasOwnProperty.call(input, "body") ? input.body : undefined,
      reason: typeof input.reason === "string" ? input.reason : undefined
    });
  } else {
    throw new Error("Unknown command. Use identity, catalog, search, describe, or request.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
`;
}

