import type { ActionConnectorConfig } from "../center/action-connector-adapter.js";

export type ActionDescriptor = {
  id: string;
  title: string;
  description?: string;
  risk: "read" | "low" | "high" | string;
  scopes?: string[];
  inputSchema?: Record<string, unknown>;
};

export type ConnectorActionRequest = {
  actionId: string;
  input?: Record<string, unknown>;
  dryRun?: boolean;
};

type FetchLike = typeof fetch;

function unwrapConnectorEnvelope(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const record = payload as Record<string, unknown>;
  if ("ret" in record) {
    if (record.ret === 1) return record.data;
    const message = typeof record.msg === "string" ? record.msg : "Connector request failed";
    throw new Error(message);
  }
  return payload;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class ActionConnectorClient {
  constructor(
    private readonly config: ActionConnectorConfig,
    private readonly delegationHeaderValue: string,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  async list(signal?: AbortSignal): Promise<ActionDescriptor[]> {
    const payload = await this.request("GET", this.config.actionListPath, undefined, signal);
    return Array.isArray(payload) ? (payload as ActionDescriptor[]) : [];
  }

  async search(query: string, signal?: AbortSignal): Promise<ActionDescriptor[]> {
    const payload = await this.request("POST", this.config.actionSearchPath, { query }, signal);
    return Array.isArray(payload) ? (payload as ActionDescriptor[]) : [];
  }

  async describe(actionId: string, signal?: AbortSignal): Promise<ActionDescriptor | null> {
    const payload = await this.request("POST", this.config.actionDescribePath, { actionId }, signal);
    return payload && typeof payload === "object" ? (payload as ActionDescriptor) : null;
  }

  async preview(request: ConnectorActionRequest, signal?: AbortSignal): Promise<unknown> {
    return await this.request("POST", this.config.actionPreviewPath, request, signal);
  }

  async execute(request: ConnectorActionRequest, signal?: AbortSignal): Promise<unknown> {
    return await this.request("POST", this.config.actionExecutePath, request, signal);
  }

  private async request(method: "GET" | "POST", path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const headers: Record<string, string> = {
      Accept: "application/json"
    };
    headers[this.config.delegationHeader] = this.delegationHeaderValue;
    if (method === "POST") {
      headers["Content-Type"] = "application/json";
    }

    const response = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal
    });
    const payload = await readJson(response);
    if (!response.ok) {
      const detail =
        payload && typeof payload === "object" && "msg" in payload && typeof (payload as Record<string, unknown>).msg === "string"
          ? String((payload as Record<string, unknown>).msg)
          : `Connector request failed with HTTP ${response.status}`;
      throw new Error(detail);
    }
    return unwrapConnectorEnvelope(payload);
  }
}

