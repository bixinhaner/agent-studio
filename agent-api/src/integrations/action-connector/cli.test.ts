import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { actionConnectorCliSource } from "./cli.js";
import { DurableActionConnectorToolBridge } from "./proactive/durable-tool-bridge.js";
import { BOSS_API_PROFILE } from "./api-profile.fixtures.js";
import { discoveryOperationIds, handbookOperationIds } from "./api-profile.js";

const exec = promisify(execFile);
describe("shared connector CLI with durable assistant authorization", () => {
  it("searches and describes through canonical grants and preserves write method/body", async () => {
    const received: any[] = [];
    const db = {
      proactiveAgentRun: { findUnique: async () => ({ status: "RUNNING", runAttempt: 1 }), updateMany: async () => ({}) },
      connectorToolInvocation: { create: async (v: any) => { received.push(v.data); }, findUnique: async () => ({ status: "SUCCEEDED", result: { output: { ret: 1, data: { verified: true } } } }) },
    };
    const bridge = new DurableActionConnectorToolBridge(db as never);
    bridge.prepareBackgroundRun({ connectorId: "c", runId: "r", scenarioKey: "assistant:a", packageDigest: "p", handbookDigest: "h", resourceScope: [], traceId: "r", allowedOperations: [], allowDiscovery: true, operationGrants: [{ operationId: "post.device_groups", method: "POST" }], timeoutSeconds: 30, runAttempt: 1 });
    const reg = bridge.registerRun({ connectorId: "c", runId: "r", delegationHeaderValue: "x", emit: () => undefined });
    const server = createServer(async (req, res) => {
      let body = ""; for await (const chunk of req) body += chunk;
      try { const v = JSON.parse(body); const out = await bridge.request({ connectorId: "c", runId: v.runId, bridgeToken: String(req.headers["x-action-connector-bridge-token"]), request: v.input }); res.end(JSON.stringify(out)); }
      catch (error) { res.statusCode = 400; res.end(JSON.stringify({ error: { message: String(error) } })); }
    });
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    const dir = await mkdtemp(path.join(os.tmpdir(), "assistant-cli-"));
    try {
      const cli = path.join(dir, "cli.mjs"), config = path.join(dir, "runtime.json");
      await writeFile(cli, actionConnectorCliSource());
      await writeFile(config, JSON.stringify({ bridgeBaseUrl: `http://127.0.0.1:${(server.address() as {port:number}).port}`, connectorId: "c", runId: "r", bridgeToken: reg.bridgeToken }));
      const invoke = async (...args: string[]) => JSON.parse((await exec(process.execPath, [cli, ...args], { env: { ...process.env, ACTION_CONNECTOR_RUNTIME_CONFIG: config } })).stdout);
      expect(await invoke("search", "products")).toEqual({ verified: true });
      expect(await invoke("describe", "get.products")).toEqual({ verified: true });
      expect(await invoke("request", "POST", "/api/v1/device-groups", JSON.stringify({ operationId: "post.device_groups", body: { name: "isolated" } }))).toEqual({ verified: true });
      expect(received.map(x => x.operationId)).toEqual(["get.agent.catalog", "get.agent.catalog.describe", "post.device_groups"]);
      expect(received[1].arguments.query).toEqual({ operationId: "get.products" });
      expect(received[2]).toMatchObject({ method: "POST", arguments: { body: { name: "isolated" } } });
    } finally { await new Promise<void>(r => server.close(() => r())); await rm(dir, { recursive: true, force: true }); }
  });

  it("uses the connector's own catalog paths and rejects the OMC defaults for a BOSS run", async () => {
    const received: any[] = [];
    const db = {
      proactiveAgentRun: { findUnique: async () => ({ status: "RUNNING", runAttempt: 1 }), updateMany: async () => ({}) },
      connectorToolInvocation: { create: async (v: any) => { received.push(v.data); }, findUnique: async () => ({ status: "SUCCEEDED", result: { output: { ret: 1, data: { ok: true } } } }) },
    };
    const bridge = new DurableActionConnectorToolBridge(db as never);
    bridge.prepareBackgroundRun({ connectorId: "c", runId: "r", scenarioKey: "assistant:a", packageDigest: "p", handbookDigest: "h", resourceScope: [], traceId: "r", allowedOperations: [], allowDiscovery: true, operationGrants: [], timeoutSeconds: 30, runAttempt: 1,
      handbookOperations: new Set(handbookOperationIds(BOSS_API_PROFILE)), discoveryOperations: new Set(discoveryOperationIds(BOSS_API_PROFILE)) });
    const reg = bridge.registerRun({ connectorId: "c", runId: "r", delegationHeaderValue: "x", emit: () => undefined });
    const server = createServer(async (req, res) => {
      let body = ""; for await (const chunk of req) body += chunk;
      try { const v = JSON.parse(body); const out = await bridge.request({ connectorId: "c", runId: v.runId, bridgeToken: String(req.headers["x-action-connector-bridge-token"]), request: v.input }); res.end(JSON.stringify(out)); }
      catch (error) { res.statusCode = 400; res.end(JSON.stringify({ error: { message: String(error) } })); }
    });
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    const dir = await mkdtemp(path.join(os.tmpdir(), "assistant-cli-"));
    try {
      const cli = path.join(dir, "cli.mjs"), config = path.join(dir, "runtime.json"), legacy = path.join(dir, "legacy.json");
      const base = { bridgeBaseUrl: `http://127.0.0.1:${(server.address() as {port:number}).port}`, connectorId: "c", runId: "r", bridgeToken: reg.bridgeToken };
      await writeFile(cli, actionConnectorCliSource());
      await writeFile(config, JSON.stringify({ ...base, apiProfile: BOSS_API_PROFILE }));
      await writeFile(legacy, JSON.stringify(base));
      const run = (file: string, ...args: string[]) => exec(process.execPath, [cli, ...args], { env: { ...process.env, ACTION_CONNECTOR_RUNTIME_CONFIG: file } });
      const invoke = async (...args: string[]) => JSON.parse((await run(config, ...args)).stdout);
      expect(await invoke("profile")).toEqual(BOSS_API_PROFILE);
      expect(JSON.parse((await run(legacy, "profile")).stdout)).toMatchObject({ pathPrefix: "/api/v1/", skillName: "omc-operations" });
      expect(await invoke("search", "recharge")).toEqual({ ok: true });
      expect(await invoke("categories")).toEqual({ ok: true });
      expect(await invoke("describe", "payment.list_recharges")).toEqual({ ok: true });
      expect(await invoke("request", "GET", "/api/agent/ai-assistant/handbook/chunks/0", JSON.stringify({ operationId: "boss.handbook.chunk" }))).toEqual({ ok: true });
      expect(received.map(x => [x.operationId, x.path])).toEqual([
        ["boss.catalog.search", "/api/agent/ai-assistant/catalog"],
        ["boss.catalog.categories", "/api/agent/ai-assistant/catalog/categories"],
        ["boss.catalog.describe", "/api/agent/ai-assistant/catalog/describe"],
        ["boss.handbook.chunk", "/api/agent/ai-assistant/handbook/chunks/0"]
      ]);
      await expect(run(legacy, "search", "recharge")).rejects.toThrow(/outside the installed scenario policy/);
    } finally { await new Promise<void>(r => server.close(() => r())); await rm(dir, { recursive: true, force: true }); }
  });
});
