import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ActionConnectorCodexRunner } from "../runtime.js";
import { ProactiveActionConnectorService } from "../proactive/service.js";
import { DurableActionConnectorToolBridge } from "../proactive/durable-tool-bridge.js";
import { ProactiveLeaseService } from "../proactive/lease-service.js";
import { executionRequestSchema } from "./contracts.js";
import { definition } from "./fixtures.js";

const enabled = Boolean(process.env.ASSISTANT_TEST_DATABASE_URL);
const suite = enabled ? describe.sequential : describe.skip;
suite("PostgreSQL assistant lifecycle (real database + tool protocol, fixture model)", () => {
  const db = new PrismaClient({ datasourceUrl: process.env.ASSISTANT_TEST_DATABASE_URL || process.env.DATABASE_URL });
  const connectorId = `assistant-test-${randomUUID()}`;
  const created: string[] = [];
  const noData = { outcome: "insufficient_data", title: "Fixture completed", summary: "No business data requested in this queue test", facts: [], hypotheses: [], nextSteps: [] };
  const request = () => { const id = randomUUID(); created.push(id); return executionRequestSchema.parse({ contractVersion: "1.0", runId: id, assistantId: randomUUID(), revision: 1, definition, definitionDigest: `sha256:${"1".repeat(64)}`, handbookDigest: "handbook-test", apiHandbook: {}, externalUserId: "real-owner", locale: "en-US", timezone: "UTC" }); };
  const waitFor = async (check: () => Promise<boolean>, timeout = 10000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await check()) return; await new Promise((r) => setTimeout(r, 30)); } throw new Error("condition timed out"); };
  beforeAll(async () => {
    await db.integrationInstance.create({ data: { id: connectorId, type: "action_connector", slug: connectorId, name: "Assistant integration fixture", status: "active", config: { create: { config: { displayName: "Fixture" } } } } });
  });
  afterAll(async () => {
    await db.connectorToolInvocation.deleteMany({ where: { connectorId } });
    await db.proactiveAgentRun.deleteMany({ where: { connectorId } });
    await db.integrationInstance.delete({ where: { id: connectorId } }); await db.$disconnect();
  });
  it("persists an immutable snapshot, replays one run, and rejects conflicting or cross-connector reuse", async () => {
    const service = new ProactiveActionConnectorService(db, new DurableActionConnectorToolBridge(db), async () => undefined);
    const r = request(); const a = await service.submitAssistantRun(connectorId, r); const b = await service.submitAssistantRun(connectorId, r);
    expect(a.id).toBe(b.id); expect(await db.proactiveAgentRun.count({ where: { id: r.runId } })).toBe(1);
    await expect(service.submitAssistantRun(connectorId, { ...r, revision: 2 })).rejects.toThrow("CONFLICT");
    await expect(service.assistantRun("other-connector", r.runId)).rejects.toThrow("NOT_FOUND");
    await service.cancelRun(connectorId, r.runId);
    expect((await service.submitAssistantRun(connectorId, r)).status).toBe("CANCELLED");
  });
  it("executes real persistent tool leasing and validates evidence before returning a result", async () => {
    const bridge = new DurableActionConnectorToolBridge(db); const leases = new ProactiveLeaseService(db);
    const runner: ActionConnectorCodexRunner = async (input) => {
      const id = input.request.clientRunId!; const reg = input.bridge!.registerRun({ connectorId, runId: id, delegationHeaderValue: input.delegationHeaderValue, emit: input.emit });
      const pending = input.bridge!.request({ connectorId, runId: id, bridgeToken: reg.bridgeToken, request: { method: "GET", path: "/api/v1/devices", operationId: "get.devices" } });
      await waitFor(async () => (await db.connectorToolInvocation.count({ where: { runId: id } })) > 0);
      const items = await leases.leaseTools(connectorId, "local-worker", 1, 60); expect(items).toHaveLength(1);
      await leases.submitToolResult(connectorId, String(items[0].invocationId), { status: "succeeded", leaseToken: items[0].leaseToken, output: { items: [{ id: "device-fixture", name: "" }] } });
      expect((await pending).status).toBe("ok");
      input.emit({ type: "delta", text: JSON.stringify({ outcome: "finding", title: "Missing label", summary: "One device has no label", facts: [{ text: "The returned device name is blank", evidenceRefs: ["tool:get.devices"] }], hypotheses: [], nextSteps: ["Review its label"] }) }); reg.dispose();
    };
    const service = new ProactiveActionConnectorService(db, bridge, runner); const r = request(); await service.submitAssistantRun(connectorId, r); await service.start();
    try { await waitFor(async () => (await service.assistantRun(connectorId, r.runId)).status === "COMPLETED"); const got = await service.assistantRun(connectorId, r.runId); expect((got.output as { outcome: string }).outcome).toBe("finding"); expect(got.tools[0].status).toBe("SUCCEEDED"); } finally { service.stop(); }
  });
  it("never resurrects cancellation even when a runner ignores abort and returns late", async () => {
    let release!: () => void; let started = false; const blocked = new Promise<void>((resolve) => { release = resolve; });
    const service = new ProactiveActionConnectorService(db, new DurableActionConnectorToolBridge(db), async (input) => { started = true; await blocked; input.emit({ type: "delta", text: JSON.stringify(noData) }); });
    const r = request(); await service.submitAssistantRun(connectorId, r); await service.start();
    try { await waitFor(async () => started); await service.cancelRun(connectorId, r.runId); release(); await new Promise((resolve) => setTimeout(resolve, 100)); expect((await service.assistantRun(connectorId, r.runId)).status).toBe("CANCELLED"); } finally { release(); service.stop(); }
  });
  it("does not lease tools from an old execution attempt", async () => {
    const service = new ProactiveActionConnectorService(db, new DurableActionConnectorToolBridge(db), async () => undefined); const r = request(); await service.submitAssistantRun(connectorId, r);
    await db.proactiveAgentRun.update({ where: { id: r.runId }, data: { status: "RUNNING", runAttempt: 2, leaseOwner: "current", leaseExpiresAt: new Date(Date.now() + 60000) } });
    const old = await db.connectorToolInvocation.create({ data: { runId: r.runId, runAttempt: 1, connectorId, scenarioKey: `assistant:${r.assistantId}`, packageDigest: r.definitionDigest, handbookDigest: r.handbookDigest, operationId: "get.devices", method: "GET", path: "/api/v1/devices", arguments: {}, resourceScope: [], deadlineAt: new Date(Date.now() + 60000), traceId: r.runId } });
    const items = await new ProactiveLeaseService(db).leaseTools(connectorId, "worker", 10, 60); expect(items.some((item) => item.invocationId === old.id)).toBe(false); await service.cancelRun(connectorId, r.runId);
  });
  it("recovers expired runs and drains a backlog larger than the old startup-only limit", async () => {
    const bridge = new DurableActionConnectorToolBridge(db); const service = new ProactiveActionConnectorService(db, bridge, async (input) => input.emit({ type: "delta", text: JSON.stringify(noData) }));
    const rs = Array.from({ length: 55 }, request); for (const r of rs) await service.submitAssistantRun(connectorId, r);
    await db.proactiveAgentRun.update({ where: { id: rs[0].runId }, data: { status: "RUNNING", runAttempt: 1, leaseOwner: "dead-worker", leaseExpiresAt: new Date(Date.now() - 1000) } });
    await service.start(); try { await waitFor(async () => (await db.proactiveAgentRun.count({ where: { id: { in: rs.map((r) => r.runId) }, status: "COMPLETED" } })) === rs.length, 30000); expect((await db.proactiveAgentRun.findUniqueOrThrow({ where: { id: rs[0].runId } })).runAttempt).toBe(2); } finally { service.stop(); }
  }, 40000);
});
