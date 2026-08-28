import { randomUUID, timingSafeEqual } from "node:crypto";

import type { AgentStreamEvent } from "./runtime.js";

type ToolRequestStatus = "ok" | "error";

export type ExternalToolRequestInput = {
  operationId?: string;
  method: string;
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, unknown>;
  reason?: string;
};

export type ExternalToolResultInput = {
  runId: string;
  toolCallId: string;
  status: ToolRequestStatus;
  output?: unknown;
  files?: ExternalToolResultFileInput[];
  error?: {
    code: string;
    message: string;
    retryable?: boolean;
  };
};

export type ExternalToolResultFileInput = {
  attachmentId: string;
};

export type ExternalToolResultFile = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  relativePath: string;
};

type RegisteredRun = {
  connectorId: string;
  runId: string;
  bridgeToken: string;
  delegationHeaderValue: string;
  emit(event: AgentStreamEvent): void;
  materializeFiles?: (files: ExternalToolResultFileInput[]) => Promise<ExternalToolResultFile[]>;
};

export type ActionConnectorBridgeRegistration = {
  bridgeToken: string;
  setFileMaterializer: (materialize: NonNullable<RegisteredRun["materializeFiles"]>) => void;
  dispose: () => void;
};

export interface ActionConnectorToolBridgeLike {
  registerRun(input: {
    connectorId: string;
    runId: string;
    delegationHeaderValue: string;
    emit(event: AgentStreamEvent): void;
  }): ActionConnectorBridgeRegistration;
  request(input: {
    connectorId: string;
    runId: string;
    bridgeToken: string;
    toolCallId?: string;
    request: ExternalToolRequestInput;
  }): Promise<ExternalToolResultInput>;
  resolve(input: {
    connectorId: string;
    delegationHeaderValue: string;
    result: ExternalToolResultInput;
  }): Promise<void>;
  disposeRun(connectorId: string, runId: string): void;
}

type PendingToolRequest = RegisteredRun & {
  toolCallId: string;
  resolve(value: ExternalToolResultInput): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
};

function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function asToolCallId(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  return `rest-${randomUUID()}`;
}

function methodLabel(value: string): string {
  return value.trim().toUpperCase() || "GET";
}

function toolTitle(input: ExternalToolRequestInput): string {
  const method = methodLabel(input.method);
  const path = typeof input.path === "string" ? input.path.trim() : "";
  return `${method} ${path || "REST request"}`;
}

export class ActionConnectorToolBridge implements ActionConnectorToolBridgeLike {
  private readonly runs = new Map<string, RegisteredRun>();
  private readonly pending = new Map<string, PendingToolRequest>();

  constructor(private readonly timeoutMs = 120_000) {}

  registerRun(input: {
    connectorId: string;
    runId: string;
    delegationHeaderValue: string;
    emit(event: AgentStreamEvent): void;
  }): ActionConnectorBridgeRegistration {
    const bridgeToken = randomUUID();
    const key = this.runKey(input.connectorId, input.runId);
    this.runs.set(key, {
      connectorId: input.connectorId,
      runId: input.runId,
      bridgeToken,
      delegationHeaderValue: input.delegationHeaderValue,
      emit: input.emit
    });
    return {
      bridgeToken,
      setFileMaterializer: (materialize) => {
        const run = this.runs.get(key);
        if (run) run.materializeFiles = materialize;
      },
      dispose: () => this.disposeRun(input.connectorId, input.runId)
    };
  }

  async request(input: {
    connectorId: string;
    runId: string;
    bridgeToken: string;
    toolCallId?: string;
    request: ExternalToolRequestInput;
  }): Promise<ExternalToolResultInput> {
    const run = this.runs.get(this.runKey(input.connectorId, input.runId));
    if (!run || !safeEquals(run.bridgeToken, input.bridgeToken)) {
      throw new Error("External tool bridge run is not active.");
    }

    const toolCallId = asToolCallId(input.toolCallId);
    const pendingKey = this.pendingKey(input.connectorId, input.runId, toolCallId);
    if (this.pending.has(pendingKey)) {
      throw new Error("External tool call id is already pending.");
    }

    const result = new Promise<ExternalToolResultInput>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(pendingKey);
        reject(new Error("External tool request timed out."));
      }, this.timeoutMs);
      this.pending.set(pendingKey, {
        ...run,
        toolCallId,
        resolve,
        reject,
        timer
      });
    });

    run.emit({
      type: "tool_request",
      runId: run.runId,
      toolCallId,
      tool: "rest.request",
      title: toolTitle(input.request),
      input: input.request
    });

    return await result;
  }

  async resolve(input: {
    connectorId: string;
    delegationHeaderValue: string;
    result: ExternalToolResultInput;
  }): Promise<void> {
    const key = this.pendingKey(input.connectorId, input.result.runId, input.result.toolCallId);
    const pending = this.pending.get(key);
    if (!pending) {
      throw new Error("External tool request is not pending.");
    }
    if (!safeEquals(pending.delegationHeaderValue, input.delegationHeaderValue)) {
      throw new Error("External tool result delegation does not match the active run.");
    }
    clearTimeout(pending.timer);
    this.pending.delete(key);
    const requestedFiles = (input.result.files ?? [])
      .map((file) => ({ attachmentId: typeof file?.attachmentId === "string" ? file.attachmentId.trim() : "" }))
      .filter((file) => Boolean(file.attachmentId));
    if (!requestedFiles.length) {
      pending.resolve({ ...input.result, files: undefined });
      return;
    }
    if (!pending.materializeFiles) {
      pending.resolve(this.fileMaterializationError(input.result, "The active run cannot receive files."));
      return;
    }
    try {
      const files = await pending.materializeFiles(requestedFiles);
      pending.resolve({ ...input.result, files });
    } catch (error) {
      pending.resolve(this.fileMaterializationError(
        input.result,
        error instanceof Error ? error.message : "Tool result files could not be prepared."
      ));
    }
  }

  disposeRun(connectorId: string, runId: string): void {
    this.runs.delete(this.runKey(connectorId, runId));
    const prefix = `${connectorId}:${runId}:`;
    for (const [key, pending] of this.pending) {
      if (!key.startsWith(prefix)) continue;
      clearTimeout(pending.timer);
      this.pending.delete(key);
      pending.reject(new Error("External tool run was disposed."));
    }
  }

  private runKey(connectorId: string, runId: string): string {
    return `${connectorId}:${runId}`;
  }

  private pendingKey(connectorId: string, runId: string, toolCallId: string): string {
    return `${connectorId}:${runId}:${toolCallId}`;
  }

  private fileMaterializationError(result: ExternalToolResultInput, message: string): ExternalToolResultInput {
    return {
      runId: result.runId,
      toolCallId: result.toolCallId,
      status: "error",
      error: {
        code: "TOOL_RESULT_FILE_UNAVAILABLE",
        message,
        retryable: false
      }
    };
  }
}
