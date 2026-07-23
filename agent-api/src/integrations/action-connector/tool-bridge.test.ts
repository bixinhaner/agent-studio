import { describe, expect, it } from "vitest";

import { ActionConnectorToolBridge } from "./tool-bridge.js";
import type { AgentStreamEvent } from "./runtime.js";

describe("ActionConnectorToolBridge", () => {
  it("emits a generic tool request and resolves the matching result", async () => {
    const bridge = new ActionConnectorToolBridge(500);
    const events: AgentStreamEvent[] = [];
    const registration = bridge.registerRun({
      connectorId: "connector-1",
      runId: "run-1",
      delegationHeaderValue: "Bearer delegated",
      emit: (event) => events.push(event)
    });

    const pending = bridge.request({
      connectorId: "connector-1",
      runId: "run-1",
      bridgeToken: registration.bridgeToken,
      toolCallId: "call-1",
      request: {
        operationId: "listDevices",
        method: "GET",
        path: "/api/v1/devices",
        query: { status: "online" }
      }
    });

    expect(events).toEqual([
      {
        type: "tool_request",
        runId: "run-1",
        toolCallId: "call-1",
        tool: "rest.request",
        title: "GET /api/v1/devices",
        input: {
          operationId: "listDevices",
          method: "GET",
          path: "/api/v1/devices",
          query: { status: "online" }
        }
      }
    ]);

    await bridge.resolve({
      connectorId: "connector-1",
      delegationHeaderValue: "Bearer delegated",
      result: {
        runId: "run-1",
        toolCallId: "call-1",
        status: "ok",
        output: { total: 1 }
      }
    });

    await expect(pending).resolves.toEqual({
      runId: "run-1",
      toolCallId: "call-1",
      status: "ok",
      output: { total: 1 }
    });
  });

  it("materializes tool result files into the active run before resolving", async () => {
    const bridge = new ActionConnectorToolBridge(500);
    const registration = bridge.registerRun({
      connectorId: "connector-1",
      runId: "run-1",
      delegationHeaderValue: "Bearer delegated",
      emit: () => undefined
    });
    registration.setFileMaterializer(async (files) => files.map((file) => ({
      attachmentId: file.attachmentId,
      filename: "report.csv",
      mimeType: "text/csv",
      sizeBytes: 12,
      sha256: "abc123",
      createdAt: "2026-07-23T00:00:00.000Z",
      relativePath: ".uploads/conversation/report.csv"
    })));

    const pending = bridge.request({
      connectorId: "connector-1",
      runId: "run-1",
      bridgeToken: registration.bridgeToken,
      toolCallId: "call-file",
      request: { method: "GET", path: "/api/v1/reports/export" }
    });
    await bridge.resolve({
      connectorId: "connector-1",
      delegationHeaderValue: "Bearer delegated",
      result: {
        runId: "run-1",
        toolCallId: "call-file",
        status: "ok",
        output: { type: "file" },
        files: [{ attachmentId: "0123456789abcdef0123456789abcdef" }]
      }
    });

    await expect(pending).resolves.toEqual({
      runId: "run-1",
      toolCallId: "call-file",
      status: "ok",
      output: { type: "file" },
      files: [{
        attachmentId: "0123456789abcdef0123456789abcdef",
        filename: "report.csv",
        mimeType: "text/csv",
        sizeBytes: 12,
        sha256: "abc123",
        createdAt: "2026-07-23T00:00:00.000Z",
        relativePath: ".uploads/conversation/report.csv"
      }]
    });
  });

  it("rejects a result with the wrong delegation header", async () => {
    const bridge = new ActionConnectorToolBridge(500);
    const registration = bridge.registerRun({
      connectorId: "connector-1",
      runId: "run-1",
      delegationHeaderValue: "Bearer delegated",
      emit: () => undefined
    });

    const pending = bridge.request({
      connectorId: "connector-1",
      runId: "run-1",
      bridgeToken: registration.bridgeToken,
      toolCallId: "call-1",
      request: { method: "GET", path: "/api/v1/devices" }
    });

    await expect(
      bridge.resolve({
        connectorId: "connector-1",
        delegationHeaderValue: "Bearer other",
        result: {
          runId: "run-1",
          toolCallId: "call-1",
          status: "ok",
          output: {}
        }
      })
    ).rejects.toThrow(/delegation does not match/);

    registration.dispose();
    await expect(pending).rejects.toThrow(/disposed/);
  });
});
