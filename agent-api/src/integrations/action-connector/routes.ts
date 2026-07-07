import express, { type Request, type Response } from "express";

import { createSseAbortLifecycle, initSSE, sendSSE } from "../../sse.js";
import type { IntegrationInstanceRepositoryDb } from "../../persistence/integration-instance-repository.js";
import {
  actionConnectorChatRequestSchema,
  ActionConnectorRuntimeService,
  type ActionConnectorCodexRunner,
  type AgentStreamEvent
} from "./runtime.js";

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
}) {
  const router = express.Router();
  const runtime = new ActionConnectorRuntimeService(options.db, options.fetchImpl, options.codexRunner);

  router.post("/:connectorId/chat/stream", async (req: Request, res: Response) => {
    initSSE(res);
    const lifecycle = createSseAbortLifecycle(req, res);
    const heartbeat = setInterval(() => sendSSE(res, "ping", { now: new Date().toISOString() }), 15000);

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
        sendAgentEvent(res, {
          type: "error",
          error: {
            code: "UPSTREAM_ERROR",
            message: error instanceof Error ? error.message : "Action connector runtime failed.",
            retryable: true
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

  return router;
}
