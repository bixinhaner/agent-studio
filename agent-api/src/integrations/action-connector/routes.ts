import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";

import { presentCodexRuntimeError } from "../../codex-runtime-user-error.js";
import { createSseAbortLifecycle, initSSE, sendSSE } from "../../sse.js";
import type { IntegrationInstanceRepositoryDb } from "../../persistence/integration-instance-repository.js";
import {
  actionConnectorChatRequestSchema,
  ActionConnectorRuntimeService,
  type ActionConnectorCodexRunner,
  type AgentStreamEvent
} from "./runtime.js";
import { ActionConnectorToolBridge, type ActionConnectorToolBridgeLike, type ExternalToolRequestInput, type ExternalToolResultInput } from "./tool-bridge.js";
import type { ProactiveLeaseService } from "./proactive/lease-service.js";
import type { ProactiveActionConnectorService } from "./proactive/service.js";

function bearerHeader(req: Request): string | undefined {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) return undefined;
  return header;
}

function sendAgentEvent(res: Response, event: AgentStreamEvent): boolean {
  return sendSSE(res, "agent", event);
}

export function createActionConnectorRuntimeRouter(options: {
  db: IntegrationInstanceRepositoryDb;
  fetchImpl?: typeof fetch;
  codexRunner?: ActionConnectorCodexRunner;
  bridge?: ActionConnectorToolBridgeLike;
  proactive?: ProactiveActionConnectorService;
  proactiveLeases?: ProactiveLeaseService;
  serviceTokenMiddleware?: RequestHandler;
}) {
  const router = express.Router();
  const bridge = options.bridge ?? new ActionConnectorToolBridge();
  const runtime = new ActionConnectorRuntimeService(options.db, options.fetchImpl, options.codexRunner, bridge);
  const requireService = options.serviceTokenMiddleware ?? ((_req: Request, _res: Response, next: NextFunction) => next());

  // These endpoints are service-to-service only. xOMC owns assistant identities,
  // revisions, authorization, and scheduling; Studio receives execution snapshots.
  router.post("/:connectorId/assistant-builder/plan", requireService, async (req: Request, res: Response) => {
    if (!options.proactive) return void res.status(503).json({ error: { code: "PROACTIVE_RUNTIME_UNAVAILABLE" } });
    const controller = new AbortController();
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    res.on("close", disconnect);
    try { res.json(await options.proactive.planAssistant(req.params.connectorId, req.body, controller.signal)); }
    catch (error) { assistantError(res, error); }
    finally { res.off("close", disconnect); }
  });
  router.post("/:connectorId/assistant-runs", requireService, async (req: Request, res: Response) => {
    if (!options.proactive) return void res.status(503).json({ error: { code: "PROACTIVE_RUNTIME_UNAVAILABLE" } });
    try { res.status(202).json(await options.proactive.submitAssistantRun(req.params.connectorId, req.body)); }
    catch (error) { assistantError(res, error); }
  });
  router.get("/:connectorId/assistant-runs/:runId", requireService, async (req: Request, res: Response) => {
    if (!options.proactive) return void res.status(503).json({ error: { code: "PROACTIVE_RUNTIME_UNAVAILABLE" } });
    try { res.json(await options.proactive.assistantRun(req.params.connectorId, req.params.runId)); }
    catch (error) { assistantError(res, error); }
  });

  router.post("/:connectorId/events", requireService, async (req: Request, res: Response) => {
    if (!options.proactive) return void res.status(503).json({ error: { code: "PROACTIVE_RUNTIME_UNAVAILABLE" } });
    try {
      res.status(202).json(await options.proactive.receiveEvent(req.params.connectorId, req.body));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Event was rejected.";
      res.status(message.includes("NOT_INSTALLED") || message.includes("NOT_ACTIVE") ? 409 : 400)
        .json({ error: { code: message, message } });
    }
  });

  router.get("/:connectorId/proactive/overview", requireService, async (req: Request, res: Response) => {
    if (!options.proactive) return void res.status(503).json({ error: { code: "PROACTIVE_RUNTIME_UNAVAILABLE" } });
    try {
      res.json(await options.proactive.overview(req.params.connectorId));
    } catch (error) {
      res.status(409).json({ error: { code: "PROACTIVE_OVERVIEW_FAILED", message: error instanceof Error ? error.message : "Unable to load proactive overview." } });
    }
  });

  router.patch("/:connectorId/proactive/scenarios/:scenarioKey", requireService, async (req: Request, res: Response) => {
    if (!options.proactive) return void res.status(503).json({ error: { code: "PROACTIVE_RUNTIME_UNAVAILABLE" } });
    const body = (req.body || {}) as Record<string, unknown>;
    try {
	  const requestedMode = body.status === "DISABLED" ? "disabled" : body.rolloutMode === "SHADOW" ? "shadow" : body.rolloutMode === "FULL" || body.rolloutMode === "PERCENTAGE" ? "active" : undefined;
      await options.proactive.updateScenario(req.params.connectorId, req.params.scenarioKey, {
        rolloutMode: requestedMode,
        rolloutPercentage: typeof body.rolloutPercentage === "number" ? body.rolloutPercentage : undefined,
        maxConcurrentRuns: typeof body.maxConcurrentRuns === "number" ? body.maxConcurrentRuns : undefined,
        maxRunsPerHour: typeof body.maxRunsPerHour === "number" ? body.maxRunsPerHour : undefined
      });
	  const overview = await options.proactive.overview(req.params.connectorId);
	  res.json(overview.scenarios.find((scenario) => scenario.key === req.params.scenarioKey));
    } catch (error) {
      res.status(400).json({ error: { code: "SCENARIO_UPDATE_REJECTED", message: error instanceof Error ? error.message : "Scenario update was rejected." } });
    }
  });

  router.post("/:connectorId/proactive/runs/:runId/cancel", requireService, async (req: Request, res: Response) => {
    if (!options.proactive) return void res.status(503).json({ error: { code: "PROACTIVE_RUNTIME_UNAVAILABLE" } });
    try {
      res.json(await options.proactive.cancelRun(req.params.connectorId, req.params.runId));
    } catch (error) {
      res.status(409).json({ error: { code: "RUN_CANCEL_REJECTED", message: error instanceof Error ? error.message : "Run cannot be cancelled." } });
    }
  });

  router.post("/:connectorId/proactive/heartbeat", requireService, async (req: Request, res: Response) => {
    if (!options.proactive) return void res.status(503).json({ error: { code: "PROACTIVE_RUNTIME_UNAVAILABLE" } });
    const body = (req.body || {}) as Record<string, unknown>;
    if (typeof body.workerId !== "string" || typeof body.handbookDigest !== "string") {
      return void res.status(400).json({ error: { code: "INVALID_HEARTBEAT", message: "workerId and handbookDigest are required." } });
    }
    try {
      const details = body.details && typeof body.details === "object" && !Array.isArray(body.details)
        ? body.details as Record<string, unknown>
        : undefined;
      await options.proactive.heartbeat(req.params.connectorId, {
        workerId: body.workerId,
        handbookDigest: body.handbookDigest,
        queueDepth: typeof body.queueDepth === "number" ? body.queueDepth : 0,
        details
      });
      res.json({ ok: true, receivedAt: new Date().toISOString() });
    } catch (error) {
      res.status(409).json({ error: { code: "HEARTBEAT_REJECTED", message: error instanceof Error ? error.message : "Heartbeat was rejected." } });
    }
  });

  router.post("/:connectorId/tool-invocations/lease", requireService, async (req: Request, res: Response) => {
    if (!options.proactiveLeases) return void res.status(503).json({ error: { code: "PROACTIVE_RUNTIME_UNAVAILABLE" } });
    const body = (req.body || {}) as Record<string, unknown>;
    try {
      const items = await options.proactiveLeases.leaseTools(
        req.params.connectorId, typeof body.workerId === "string" ? body.workerId : "unknown",
        Number(body.maxItems), Number(body.leaseSeconds)
      );
      res.json({ items });
    } catch (error) {
      res.status(409).json({ error: { code: "TOOL_LEASE_FAILED", message: error instanceof Error ? error.message : "Tool lease failed." } });
    }
  });

  router.post("/:connectorId/tool-invocations/:invocationId/result", requireService, async (req: Request, res: Response) => {
    if (!options.proactiveLeases) return void res.status(503).json({ error: { code: "PROACTIVE_RUNTIME_UNAVAILABLE" } });
    try {
      await options.proactiveLeases.submitToolResult(req.params.connectorId, req.params.invocationId, req.body || {});
      res.json({ ok: true });
    } catch (error) {
      res.status(409).json({ error: { code: "TOOL_RESULT_REJECTED", message: error instanceof Error ? error.message : "Tool result rejected." } });
    }
  });

  router.post("/:connectorId/findings/lease", requireService, async (req: Request, res: Response) => {
    if (!options.proactiveLeases) return void res.status(503).json({ error: { code: "PROACTIVE_RUNTIME_UNAVAILABLE" } });
    const body = (req.body || {}) as Record<string, unknown>;
    try {
      const items = await options.proactiveLeases.leaseFindings(
        req.params.connectorId, typeof body.workerId === "string" ? body.workerId : "unknown",
        Number(body.maxItems), Number(body.leaseSeconds)
      );
      res.json({ items });
    } catch (error) {
      res.status(409).json({ error: { code: "FINDING_LEASE_FAILED", message: error instanceof Error ? error.message : "Finding lease failed." } });
    }
  });

  router.post("/:connectorId/findings/:deliveryId/ack", requireService, async (req: Request, res: Response) => {
    if (!options.proactiveLeases) return void res.status(503).json({ error: { code: "PROACTIVE_RUNTIME_UNAVAILABLE" } });
    try {
      await options.proactiveLeases.acknowledgeFinding(req.params.connectorId, req.params.deliveryId, req.body || {});
      res.json({ ok: true });
    } catch (error) {
      res.status(409).json({ error: { code: "FINDING_ACK_REJECTED", message: error instanceof Error ? error.message : "Finding acknowledgement rejected." } });
    }
  });

  router.post("/:connectorId/chat/stream", async (req: Request, res: Response) => {
    initSSE(res);
    const lifecycle = createSseAbortLifecycle(req, res);
    const heartbeat = setInterval(() => sendSSE(res, "ping", { now: new Date().toISOString() }), 15000);
    let requestLocale = req.header("accept-language");

    try {
      const delegationHeaderValue = bearerHeader(req);
      if (!delegationHeaderValue) {
        sendAgentEvent(res, {
          type: "error",
          error: { code: "UNAUTHORIZED", message: "Missing delegation bearer token.", retryable: false }
        });
        return;
      }

      const request = actionConnectorChatRequestSchema.parse(req.body || {});
      requestLocale = request.locale;
      await runtime.streamChat({
        connectorId: req.params.connectorId,
        delegationHeaderValue,
        request,
        signal: lifecycle.signal,
        emit: (event) => {
          sendAgentEvent(res, event);
          lifecycle.recordSentEvent(event.type);
        }
      });
      lifecycle.markSettled();
    } catch (error) {
      if (!lifecycle.disconnected) {
        const runtimeError = presentCodexRuntimeError(error, requestLocale);
        sendAgentEvent(res, {
          type: "error",
          error: {
            code: runtimeError?.code ?? "UPSTREAM_ERROR",
            message: runtimeError?.message ?? (error instanceof Error ? error.message : "Action connector runtime failed."),
            retryable: runtimeError?.retryable ?? true
          }
        });
      }
    } finally {
      clearInterval(heartbeat);
      lifecycle.markSettled();
      lifecycle.dispose();
      res.end();
    }
  });

  router.post("/:connectorId/tool-requests", async (req: Request, res: Response) => {
    const bridgeToken = req.header("x-action-connector-bridge-token")?.trim();
    if (!bridgeToken) {
      res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Missing bridge token." } });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const runId = typeof body.runId === "string" ? body.runId.trim() : "";
    const toolCallId = typeof body.toolCallId === "string" ? body.toolCallId.trim() : undefined;
    const input = body.input && typeof body.input === "object" && !Array.isArray(body.input)
      ? body.input as ExternalToolRequestInput
      : undefined;
    if (!runId || !input || typeof input.method !== "string" || typeof input.path !== "string") {
      res.status(400).json({ error: { code: "INVALID_TOOL_REQUEST", message: "runId and REST input are required." } });
      return;
    }

    try {
      const result = await bridge.request({
        connectorId: req.params.connectorId,
        runId,
        bridgeToken,
        toolCallId,
        request: input
      });
      res.json(result);
    } catch (error) {
      res.status(504).json({
        status: "error",
        error: {
          code: "TOOL_BRIDGE_ERROR",
          message: error instanceof Error ? error.message : "External tool bridge failed.",
          retryable: true
        }
      });
    }
  });

  router.post("/:connectorId/tool-results", async (req: Request, res: Response) => {
    const delegationHeaderValue = bearerHeader(req);
    if (!delegationHeaderValue) {
      res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Missing delegation bearer token." } });
      return;
    }

    const body = (req.body || {}) as Partial<ExternalToolResultInput>;
    if (
      typeof body.runId !== "string" ||
      typeof body.toolCallId !== "string" ||
      (body.status !== "ok" && body.status !== "error")
    ) {
      res.status(400).json({ error: { code: "INVALID_TOOL_RESULT", message: "runId, toolCallId and status are required." } });
      return;
    }

    try {
      await bridge.resolve({
        connectorId: req.params.connectorId,
        delegationHeaderValue,
        result: body as ExternalToolResultInput
      });
      res.json({ ok: true });
    } catch (error) {
      res.status(404).json({
        error: {
          code: "TOOL_RESULT_REJECTED",
          message: error instanceof Error ? error.message : "External tool result was rejected.",
          retryable: false
        }
      });
    }
  });

  return router;
}

function assistantError(res: Response, error: unknown): void {
  const code = error instanceof Error ? error.message : "ASSISTANT_REQUEST_FAILED";
  const status = code.includes("NOT_FOUND") ? 404 : code.includes("CONFLICT") ? 409 : code.includes("QUEUE_FULL") ? 429 : 400;
  if (!res.headersSent) res.status(status).json({ error: { code: code.slice(0, 2000) } });
}
