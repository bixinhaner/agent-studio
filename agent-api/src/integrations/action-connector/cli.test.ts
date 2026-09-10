import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { actionConnectorCliSource } from "./cli.js";
import { DurableActionConnectorToolBridge } from "./proactive/durable-tool-bridge.js";

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
});
