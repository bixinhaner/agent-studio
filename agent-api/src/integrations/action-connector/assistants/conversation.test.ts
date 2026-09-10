import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { assistantConversationId } from "./conversation.js";
import { executionRequestSchema } from "./contracts.js";
import { definition } from "./fixtures.js";
import { executeAssistant } from "./engine.js";

function request() {
  return executionRequestSchema.parse({ contractVersion: "1.1", runId: randomUUID(), assistantId: randomUUID(), revision: 1,
    definition: { ...definition, apiAccess: "discover", allowedMethods: ["GET", "PATCH"] },
    definitionDigest: `sha256:${"1".repeat(64)}`, contextScopeDigest: `sha256:${"2".repeat(64)}`,
    handbookDigest: "h1", apiHandbook: {}, externalUserId: "owner",
    toolGrants: [{ operationId: "get.devices", method: "GET" }, { operationId: "patch.devices", method: "PATCH" }],
    toolPolicy: { allowedMethods: ["GET", "PATCH"], blockedPathPrefixes: ["/api/v1/auth", "/api/v1/secrets"], toolTimeoutSeconds: 30, maxResponseBytes: 10000 },
  });
}
const run = () => ({ id: randomUUID(), runAttempt: 1 });

describe("assistant conversation continuity", () => {
  it("keeps one conversation across runs, recovery attempts, goal revisions and handbook refreshes", () => {
    const r = request(); const expected = assistantConversationId(r, run());
    const changed = structuredClone(r);
    changed.runId = randomUUID(); changed.revision++; changed.definition.goal = "Continue our work";
    changed.definition.name = "New name"; changed.definition.trigger = { kind: "interval", intervalMinutes: 30, conditions: [] };
    changed.definition.operations = []; changed.handbookDigest = "h2";
    expect(assistantConversationId(changed, { id: changed.runId, runAttempt: 2 })).toBe(expected);
    changed.definition.allowedMethods!.reverse(); changed.toolPolicy!.allowedMethods.reverse();
    changed.toolPolicy!.blockedPathPrefixes.reverse(); changed.toolGrants!.reverse();
    expect(assistantConversationId(changed, run())).toBe(expected);
  });
  it("separates assistants and changes of source visibility, target or effective permission", () => {
    const r = request(); const expected = assistantConversationId(r, run());
    for (const change of [
      (v: typeof r) => { v.assistantId = randomUUID(); },
      (v: typeof r) => { v.contextScopeDigest = `sha256:${"3".repeat(64)}`; },
      (v: typeof r) => { v.definition.scope = { kind: "device", deviceId: randomUUID() }; },
      (v: typeof r) => { v.toolGrants!.pop(); },
      (v: typeof r) => { v.toolPolicy!.allowedMethods = ["GET"]; },
      (v: typeof r) => { v.toolPolicy!.blockedPathPrefixes.push("/api/v1/devices"); },
    ]) { const changed = structuredClone(r); change(changed); expect(assistantConversationId(changed, run())).not.toBe(expected); }
  });
  it("retains per-attempt isolation for pre-upgrade source requests and rejects an invalid scope digest", () => {
    const r = request(); delete r.contextScopeDigest;
    const a = run(); expect(assistantConversationId(r, a)).not.toBe(assistantConversationId(r, { ...a, runAttempt: 2 }));
    expect(() => executionRequestSchema.parse({ ...r, contextScopeDigest: "unbound" })).toThrow();
  });
  it("keeps fixed API permissions in the context boundary", () => {
    const r = request(); delete r.definition.apiAccess; delete r.definition.allowedMethods;
    const id = assistantConversationId(r, run()); r.definition.operations = ["get.other"];
    expect(assistantConversationId(r, run())).not.toBe(id);
  });
  it("passes a stable conversation with distinct runs and current-only evidence to the shared executor", async () => {
    const r = request();
    const result = { outcome: "finding", title: "A device needs attention", summary: "Current evidence", facts: [{ text: "One device", evidenceRefs: ["tool:get.devices"] }], hypotheses: [], nextSteps: [] };
    const streamChat = vi.fn(async (input: { emit: (e: unknown) => void }) => input.emit({ type: "delta", text: JSON.stringify(result) }));
    const findMany = vi.fn(async () => [{ operationId: "get.devices" }]);
    for (let i = 0; i < 2; i++) {
      await executeAssistant({ db: { connectorToolInvocation: { findMany } }, runtime: { streamChat }, bridge: { prepareBackgroundRun: vi.fn() },
        run: { ...run(), connectorId: "c" }, request: r, signal: new AbortController().signal } as never);
    }
    const first = (streamChat.mock.calls[0][0] as unknown as {request: {conversationId: string; clientRunId: string; message: string; context: unknown}}).request;
    const second = (streamChat.mock.calls[1][0] as unknown as {request: typeof first}).request;
    expect(first.conversationId).toBe(second.conversationId); expect(first.clientRunId).not.toBe(second.clientRunId);
    expect(first.context).toMatchObject({ title: r.definition.name, assistantRunAttempt: 1 });
    expect(second.message).toContain("not evidence of current state");
    expect(findMany.mock.calls).toHaveLength(2);
    // A remembered result cannot pass the current-run evidence gate by itself.
    findMany.mockResolvedValue([]);
    await expect(executeAssistant({ db: { connectorToolInvocation: { findMany } }, runtime: { streamChat }, bridge: { prepareBackgroundRun: vi.fn() },
      run: { ...run(), connectorId: "c" }, request: r, signal: new AbortController().signal } as never)).rejects.toThrow("NO_BUSINESS_EVIDENCE");
  });
});
