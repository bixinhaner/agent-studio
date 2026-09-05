import { randomUUID, timingSafeEqual } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

import type { AgentStreamEvent } from "../runtime.js";
import {
  ActionConnectorToolBridge,
  type ActionConnectorBridgeRegistration,
  type ActionConnectorToolBridgeLike,
  type ExternalToolRequestInput,
  type ExternalToolResultInput
} from "../tool-bridge.js";
import type { ResourceRef } from "./contracts.js";

// Background agents may bootstrap the immutable API handbook before using a
// scenario's business operations. These two GET-only operations are transport
// infrastructure, not an expansion of the scenario's data-access allowlist.
export const BACKGROUND_HANDBOOK_OPERATIONS = new Set([
  "get.agent.handbook.manifest",
  "get.agent.handbook.chunks.by_index"
]);

type BackgroundRegistration = {
  connectorId: string;
  runId: string;
  scenarioKey: string;
  packageDigest: string;
  handbookDigest: string;
  resourceScope: ResourceRef[];
  traceId: string;
  allowedOperations: string[];
  timeoutSeconds: number;
  maxToolCalls?: number;
  runAttempt?: number;
  signal?: AbortSignal;
  toolCalls?: number;
  deadlineAt?: number;
  bridgeToken?: string;
  emit?: (event: AgentStreamEvent) => void;
};

function safeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DurableActionConnectorToolBridge implements ActionConnectorToolBridgeLike {
  private readonly interactive = new ActionConnectorToolBridge();
  private readonly background = new Map<string, BackgroundRegistration>();

  constructor(private readonly db: PrismaClient) {}

  prepareBackgroundRun(input: Omit<BackgroundRegistration, "bridgeToken" | "emit">): void {
    this.background.set(this.key(input.connectorId, input.runId), { ...input, toolCalls: 0, deadlineAt: Date.now() + input.timeoutSeconds * 1000 });
  }

  registerRun(input: {
    connectorId: string; runId: string; delegationHeaderValue: string; emit(event: AgentStreamEvent): void;
  }): ActionConnectorBridgeRegistration {
    const key = this.key(input.connectorId, input.runId);
    const registration = this.background.get(key);
    if (!registration) return this.interactive.registerRun(input);
    const bridgeToken = randomUUID();
    registration.bridgeToken = bridgeToken;
    registration.emit = input.emit;
    return {
      bridgeToken,
      setFileMaterializer: () => undefined,
      dispose: () => this.disposeRun(input.connectorId, input.runId)
    };
  }

  async request(input: {
    connectorId: string; runId: string; bridgeToken: string; toolCallId?: string; request: ExternalToolRequestInput;
  }): Promise<ExternalToolResultInput> {
    const registration = this.background.get(this.key(input.connectorId, input.runId));
    if (!registration) return await this.interactive.request(input);
    if (!registration.bridgeToken || !safeEquals(registration.bridgeToken, input.bridgeToken)) {
      throw new Error("External tool bridge run is not active.");
    }
    registration.signal?.throwIfAborted();
    const active = await this.db.proactiveAgentRun.findUnique({ where: { id: input.runId } });
    if (!active || !["RUNNING", "WAITING_TOOL"].includes(active.status) ||
        (registration.runAttempt !== undefined && active.runAttempt !== registration.runAttempt)) {
      throw new Error("BACKGROUND_RUN_NOT_ACTIVE");
    }
    const operationId = input.request.operationId?.trim() ?? "";
    const allowedOperation = registration.allowedOperations.includes(operationId) ||
      BACKGROUND_HANDBOOK_OPERATIONS.has(operationId);
    if (input.request.method.toUpperCase() !== "GET" || !allowedOperation) {
      throw new Error("Background tool operation is outside the installed scenario policy.");
    }
    if (!BACKGROUND_HANDBOOK_OPERATIONS.has(operationId)) {
      registration.toolCalls = (registration.toolCalls ?? 0) + 1;
      if (registration.toolCalls > (registration.maxToolCalls ?? 18)) throw new Error("BACKGROUND_TOOL_BUDGET_EXCEEDED");
    }
    const toolCallId = `${input.runId}-${active.runAttempt}-${input.toolCallId?.trim() || randomUUID()}`;
    const deadlineAt = new Date(registration.deadlineAt ?? Date.now() + registration.timeoutSeconds * 1000);
    await this.db.connectorToolInvocation.create({
      data: {
        id: toolCallId, runId: input.runId, runAttempt: active.runAttempt, connectorId: input.connectorId,
        scenarioKey: registration.scenarioKey, packageDigest: registration.packageDigest,
        handbookDigest: registration.handbookDigest, operationId,
        method: "GET", path: input.request.path,
        arguments: {
          path: {}, query: input.request.query ?? {}, body: null
        } as Prisma.InputJsonValue,
        resourceScope: registration.resourceScope as Prisma.InputJsonValue,
        deadlineAt, traceId: registration.traceId
      }
    });
    await this.db.proactiveAgentRun.updateMany({ where: { id: input.runId, runAttempt: active.runAttempt, status: { in: ["RUNNING", "WAITING_TOOL"] } }, data: { status: "WAITING_TOOL" } });
    registration.emit?.({
      type: "tool_request", runId: input.runId, toolCallId, tool: "rest.request",
      title: `GET ${input.request.path}`, input: input.request
    });
    while (Date.now() < deadlineAt.getTime()) {
      registration.signal?.throwIfAborted();
      const current = await this.db.proactiveAgentRun.findUnique({ where: { id: input.runId } });
      if (!current || current.runAttempt !== active.runAttempt || !["RUNNING", "WAITING_TOOL"].includes(current.status)) {
        throw new Error("BACKGROUND_RUN_NOT_ACTIVE");
      }
      const invocation = await this.db.connectorToolInvocation.findUnique({ where: { id: toolCallId } });
      if (invocation?.status === "SUCCEEDED") {
        await this.db.proactiveAgentRun.updateMany({ where: { id: input.runId, runAttempt: active.runAttempt, status: { in: ["RUNNING", "WAITING_TOOL"] } }, data: { status: "RUNNING" } });
        const result = invocation.result as Record<string, unknown> | null;
        return { runId: input.runId, toolCallId, status: "ok", output: result?.output };
      }
      if (invocation?.status === "FAILED" || invocation?.status === "EXPIRED") {
        await this.db.proactiveAgentRun.updateMany({ where: { id: input.runId, runAttempt: active.runAttempt, status: { in: ["RUNNING", "WAITING_TOOL"] } }, data: { status: "RUNNING" } });
        const result = (invocation.error ?? {}) as Record<string, unknown>;
        const error = (result.error ?? {}) as Record<string, unknown>;
        return { runId: input.runId, toolCallId, status: "error", error: {
          code: typeof error.code === "string" ? error.code : "TOOL_FAILED",
          message: typeof error.message === "string" ? error.message : "Background tool request failed.",
          retryable: error.retryable === true
        } };
      }
      await sleep(250);
    }
    await this.db.connectorToolInvocation.updateMany({
      where: { id: toolCallId, status: { in: ["PENDING", "LEASED"] } }, data: { status: "EXPIRED" }
    });
    throw new Error("External tool request timed out.");
  }

  async resolve(input: { connectorId: string; delegationHeaderValue: string; result: ExternalToolResultInput }): Promise<void> {
    return await this.interactive.resolve(input);
  }

  disposeRun(connectorId: string, runId: string): void {
    const key = this.key(connectorId, runId);
    if (this.background.delete(key)) return;
    this.interactive.disposeRun(connectorId, runId);
  }

  private key(connectorId: string, runId: string): string { return `${connectorId}:${runId}`; }
}
