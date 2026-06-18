import fs from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { shutdownCodexAppServerRuntime } from "./codex-app-server-runtime.js";
import { CodexRuntime, type CodexStreamEvent } from "./codex-runtime.js";

const testTempDir = path.resolve(process.cwd(), "..", "temp", "codex-app-server-runtime-test");
const fakeBinaryPath = path.join(testTempDir, "fake-codex-app-server.mjs");
const fakeLogPath = path.join(testTempDir, "fake-codex-app-server.log");

const originalEnv = {
  CODEX_RUNTIME_DRIVER: process.env.CODEX_RUNTIME_DRIVER,
  CODEX_APP_SERVER_BINARY: process.env.CODEX_APP_SERVER_BINARY,
  CODEX_APP_SERVER_MAX_PROCESSES: process.env.CODEX_APP_SERVER_MAX_PROCESSES,
  CODEX_APP_SERVER_MAX_ACTIVE_TURNS: process.env.CODEX_APP_SERVER_MAX_ACTIVE_TURNS,
  APP_SERVER_TEST_LOG: process.env.APP_SERVER_TEST_LOG
};

async function writeFakeAppServer(): Promise<void> {
  await fs.mkdir(testTempDir, { recursive: true });
  await fs.writeFile(
    fakeBinaryPath,
    `#!/usr/bin/env node
import fs from "node:fs";
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let nextThreadId = 1;
let nextTurnId = 1;
const threads = new Set();

function write(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

function log(event) {
  if (!process.env.APP_SERVER_TEST_LOG) return;
  fs.appendFileSync(process.env.APP_SERVER_TEST_LOG, JSON.stringify({ pid: process.pid, ...event }) + "\\n");
}

function respond(id, result) {
  write({ id, result });
}

function notify(method, params) {
  write({ method, params });
}

rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (!Object.prototype.hasOwnProperty.call(message, "id")) {
    return;
  }
  const id = message.id;
  const params = message.params || {};
  if (message.method === "initialize") {
    log({ event: "initialize" });
    respond(id, {});
    return;
  }
  if (message.method === "thread/start") {
    log({ event: "thread/start", params });
    const threadId = "thread-" + nextThreadId++;
    threads.add(threadId);
    respond(id, { thread: { id: threadId } });
    return;
  }
  if (message.method === "thread/resume") {
    log({ event: "thread/resume", params });
    if (!threads.has(params.threadId)) {
      write({ id, error: { message: "no rollout found for thread id " + params.threadId } });
      return;
    }
    respond(id, { thread: { id: params.threadId } });
    return;
  }
  if (message.method === "turn/start") {
    const threadId = params.threadId;
    if (!threads.has(threadId)) {
      write({ id, error: { message: "no rollout found for thread id " + threadId } });
      return;
    }
    const turnId = "turn-" + nextTurnId++;
    const inputText = Array.isArray(params.input) && params.input[0] && typeof params.input[0].text === "string" ? params.input[0].text : "";
    const markdownWhitespaceText = "Intro\\n\\n![Example](</tmp/image one.png>)\\n\\n| A | B |\\n|---|---|\\n| 1 | 2 |\\n";
    respond(id, { turn: { id: turnId } });
    setTimeout(() => {
      notify("turn/started", { threadId, turn: { id: turnId } });
      if (inputText === "markdown-whitespace") {
        for (const delta of [
          "Intro",
          "\\n\\n",
          "![Example](",
          "</tmp/image one.png>",
          ")",
          "\\n\\n",
          "| A | B |",
          "\\n",
          "|---|---|",
          "\\n",
          "| 1 | 2 |",
          "\\n"
        ]) {
          notify("item/agentMessage/delta", { threadId, turnId, itemId: "msg-1", delta });
        }
        notify("item/completed", {
          threadId,
          turnId,
          item: { id: "msg-1", type: "agentMessage", text: markdownWhitespaceText },
          completedAtMs: Date.now()
        });
        notify("turn/completed", { threadId, turn: { id: turnId } });
        return;
      }
      notify("item/agentMessage/delta", { threadId, turnId, itemId: "msg-1", delta: "Hel" });
      notify("item/agentMessage/delta", { threadId, turnId, itemId: "msg-1", delta: "lo" });
      notify("item/completed", {
        threadId,
        turnId,
        item: { id: "msg-1", type: "agentMessage", text: "Hello" },
        completedAtMs: Date.now()
      });
      notify("item/completed", {
        threadId,
        turnId,
        item: { id: "img-1", type: "imageGeneration", savedPath: "/tmp/poster.png", revisedPrompt: "poster" },
        completedAtMs: Date.now()
      });
      notify("rawResponseItem/completed", {
        threadId,
        turnId,
        item: { id: "raw-img-1", type: "image_generation_call", status: "completed" }
      });
      notify("thread/tokenUsage/updated", {
        threadId,
        turnId,
        tokenUsage: {
          total: { inputTokens: 12, cachedInputTokens: 3, outputTokens: 7 },
          last: { inputTokens: 12, cachedInputTokens: 3, outputTokens: 7 }
        }
      });
      notify("turn/completed", { threadId, turn: { id: turnId } });
    }, 5);
    return;
  }
  write({ id, error: { message: "unsupported method " + message.method } });
});
`,
    { mode: 0o755 }
  );
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key as keyof typeof originalEnv];
    } else {
      process.env[key] = value;
    }
  }
}

describe("Codex app-server runtime", () => {
  beforeEach(async () => {
    await writeFakeAppServer();
    await fs.rm(fakeLogPath, { force: true });
    process.env.CODEX_RUNTIME_DRIVER = "app_server";
    process.env.CODEX_APP_SERVER_BINARY = fakeBinaryPath;
    process.env.CODEX_APP_SERVER_MAX_PROCESSES = "30";
    process.env.CODEX_APP_SERVER_MAX_ACTIVE_TURNS = "2";
    process.env.APP_SERVER_TEST_LOG = fakeLogPath;
  });

  afterEach(() => {
    shutdownCodexAppServerRuntime("test cleanup");
    restoreEnv();
  });

  it("streams agent deltas, image-generation items, and usage from app-server", async () => {
    const runtime = new CodexRuntime({
      envOverrides: {
        CODEX_HOME: path.join(testTempDir, "codex-home")
      }
    });
    const thread = await runtime.startThreadWithOptions({
      model: "gpt-5.5",
      reasoningEffort: "high",
      workspace: testTempDir,
      codexRunConfig: {
        sandboxMode: "danger-full-access",
        approvalPolicy: "never",
        networkAccessEnabled: true
      }
    });

    const events: CodexStreamEvent[] = [];
    for await (const event of runtime.runStreamed(thread, "hello")) {
      events.push(event);
    }

    expect(events.filter((event) => event.type === "item.agent_message.delta").map((event) => event.delta).join("")).toBe(
      "Hello"
    );
    expect(events.some((event) => event.type === "turn.completed")).toBe(true);
    expect(events.some((event) => event.type === "token_count")).toBe(true);
    expect(
      events.some((event) => {
        const raw = event.raw as { item?: { type?: string; saved_path?: string } } | undefined;
        return event.type === "item.completed" && raw?.item?.type === "image_generation_call" && raw.item.saved_path === "/tmp/poster.png";
      })
    ).toBe(true);
    expect(
      events.some((event) => {
        const raw = event.raw as { item?: { type?: string; name?: string } } | undefined;
        return event.type === "raw_response_item.completed" && raw?.item?.type === "image_generation_call" && raw.item.name === "image_generation";
      })
    ).toBe(true);
  });

  it("preserves markdown-significant whitespace in app-server agent deltas", async () => {
    const runtime = new CodexRuntime({
      envOverrides: {
        CODEX_HOME: path.join(testTempDir, "codex-home-markdown")
      }
    });
    const thread = await runtime.startThreadWithOptions({
      model: "gpt-5.5",
      reasoningEffort: "high",
      workspace: testTempDir,
      codexRunConfig: {
        sandboxMode: "danger-full-access",
        approvalPolicy: "never",
        networkAccessEnabled: true
      }
    });

    const events: CodexStreamEvent[] = [];
    for await (const event of runtime.runStreamed(thread, "markdown-whitespace")) {
      events.push(event);
    }

    const markdownWhitespaceText = "Intro\n\n![Example](</tmp/image one.png>)\n\n| A | B |\n|---|---|\n| 1 | 2 |\n";
    const deltas = events.filter((event) => event.type === "item.agent_message.delta").map((event) => event.delta ?? "");
    expect(deltas).toContain("\n\n");
    expect(deltas).toContain("\n");
    expect(deltas.join("")).toBe(markdownWhitespaceText);

    const completed = events.find((event) => {
      const raw = event.raw as { item?: { type?: string } } | undefined;
      return event.type === "item.completed" && raw?.item?.type === "agent_message";
    });
    const completedRaw = completed?.raw as { item?: { text?: string } } | undefined;
    expect(completed?.text).toBe(markdownWhitespaceText);
    expect(completedRaw?.item?.text).toBe(markdownWhitespaceText);
  });

  it("keeps using the app-server scope that created the live thread", async () => {
    const creatingRuntime = new CodexRuntime({
      envOverrides: {
        CODEX_HOME: path.join(testTempDir, "codex-home-a")
      }
    });
    const unrelatedRuntime = new CodexRuntime({
      envOverrides: {
        CODEX_HOME: path.join(testTempDir, "codex-home-b")
      }
    });
    const thread = await creatingRuntime.startThreadWithOptions({
      model: "gpt-5.5",
      reasoningEffort: "high",
      workspace: testTempDir,
      codexRunConfig: {
        sandboxMode: "danger-full-access",
        approvalPolicy: "never"
      }
    });

    const events: CodexStreamEvent[] = [];
    for await (const event of unrelatedRuntime.runStreamed(thread, "hello")) {
      events.push(event);
    }

    expect(events.some((event) => event.type === "turn.completed")).toBe(true);
  });

  it("reuses an app-server process when only thread-scoped config and workspace temp env differ", async () => {
    const sharedCodexHome = path.join(testTempDir, "codex-home-shared");
    const runtimeA = new CodexRuntime({
      envOverrides: {
        CODEX_HOME: sharedCodexHome,
        TMPDIR: path.join(testTempDir, "workspace-a", ".agent-studio", "tmp")
      },
      appServerThreadConfig: {
        mcp_servers: {
          crest_crm: {
            command: process.execPath,
            args: ["/tmp/crest-proxy-a.mjs"],
            env: {
              AGENT_STUDIO_CREST_PROXY_TOKEN: "token-a"
            }
          }
        }
      }
    });
    const runtimeB = new CodexRuntime({
      envOverrides: {
        CODEX_HOME: sharedCodexHome,
        TMPDIR: path.join(testTempDir, "workspace-b", ".agent-studio", "tmp")
      },
      appServerThreadConfig: {
        mcp_servers: {
          crest_crm: {
            command: process.execPath,
            args: ["/tmp/crest-proxy-b.mjs"],
            env: {
              AGENT_STUDIO_CREST_PROXY_TOKEN: "token-b"
            }
          }
        }
      }
    });

    await runtimeA.startThreadWithOptions({
      model: "gpt-5.5",
      reasoningEffort: "high",
      workspace: path.join(testTempDir, "workspace-a"),
      codexRunConfig: {
        sandboxMode: "workspace-write",
        approvalPolicy: "never"
      }
    });
    await runtimeB.startThreadWithOptions({
      model: "gpt-5.5",
      reasoningEffort: "high",
      workspace: path.join(testTempDir, "workspace-b"),
      codexRunConfig: {
        sandboxMode: "workspace-write",
        approvalPolicy: "never"
      }
    });

    const logLines = (await fs.readFile(fakeLogPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { event: string; pid: number; params?: any });
    const initializedPids = new Set(logLines.filter((line) => line.event === "initialize").map((line) => line.pid));
    const starts = logLines.filter((line) => line.event === "thread/start");

    expect(initializedPids.size).toBe(1);
    expect(starts).toHaveLength(2);
    expect(starts[0]?.params?.config?.mcp_servers?.crest_crm?.env?.AGENT_STUDIO_CREST_PROXY_TOKEN).toBe("token-a");
    expect(starts[1]?.params?.config?.mcp_servers?.crest_crm?.env?.AGENT_STUDIO_CREST_PROXY_TOKEN).toBe("token-b");
  });
});
