import fs from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resolveCodexAppServerBinaryPath,
  shutdownCodexAppServerRuntime
} from "./codex-app-server-runtime.js";
import { CodexRuntime, type CodexStreamEvent } from "./codex-runtime.js";

const testTempDir = path.resolve(process.cwd(), "..", "temp", "codex-app-server-runtime-test");
const fakeBinaryPath = path.join(testTempDir, "fake-codex-app-server.mjs");

const originalEnv = {
  CODEX_RUNTIME_DRIVER: process.env.CODEX_RUNTIME_DRIVER,
  CODEX_APP_SERVER_BINARY: process.env.CODEX_APP_SERVER_BINARY,
  CODEX_APP_SERVER_MAX_PROCESSES: process.env.CODEX_APP_SERVER_MAX_PROCESSES,
  CODEX_APP_SERVER_MAX_ACTIVE_TURNS: process.env.CODEX_APP_SERVER_MAX_ACTIVE_TURNS,
  CODEX_APP_SERVER_TURN_IDLE_TIMEOUT_MS: process.env.CODEX_APP_SERVER_TURN_IDLE_TIMEOUT_MS,
  CODEX_APP_SERVER_TURN_MAX_MS: process.env.CODEX_APP_SERVER_TURN_MAX_MS
};

async function writeFakeAppServer(): Promise<void> {
  await fs.mkdir(testTempDir, { recursive: true });
  await fs.writeFile(
    fakeBinaryPath,
    `#!/usr/bin/env node
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let nextThreadId = 1;
let nextTurnId = 1;
const threads = new Set();
const pendingServerRequests = new Map();

function write(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
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
  if (!message.method && pendingServerRequests.has(id)) {
    const context = pendingServerRequests.get(id);
    pendingServerRequests.delete(id);
    const contentItems = message.result && Array.isArray(message.result.contentItems) ? message.result.contentItems : [];
    const failureText = contentItems.map((item) => item && item.text || "").join(" ");
    const errorText = message.error && typeof message.error.message === "string" ? message.error.message : "";
    const wasRejected = (message.result && message.result.success === false) || Boolean(message.error);
    if (wasRejected && (failureText || errorText).includes("Continue answering")) {
      notify("item/agentMessage/delta", {
        threadId: context.threadId,
        turnId: context.turnId,
        itemId: "continued-msg",
        delta: "Continued with available information"
      });
      notify("item/completed", {
        threadId: context.threadId,
        turnId: context.turnId,
        item: { id: "continued-msg", type: "agentMessage", text: "Continued with available information" },
        completedAtMs: Date.now()
      });
      notify("turn/completed", {
        threadId: context.threadId,
        turn: { id: context.turnId, last_agent_message: "Continued with available information" }
      });
      return;
    }
    notify("error", {
      threadId: context.threadId,
      turnId: context.turnId,
      message: "interactive request was not rejected correctly"
    });
    return;
  }
  const params = message.params || {};
  if (message.method === "initialize") {
    respond(id, {});
    return;
  }
  if (message.method === "thread/start") {
    const threadId = "thread-" + nextThreadId++;
    threads.add(threadId);
    respond(id, { thread: { id: threadId } });
    return;
  }
  if (message.method === "model/list") {
    const cursor = typeof params.cursor === "string" ? params.cursor : "";
    if (!cursor) {
      respond(id, {
        data: [{
          id: "gpt-5.6-sol",
          model: "gpt-5.6-sol",
          displayName: "GPT-5.6-Sol",
          description: "Frontier capability",
          hidden: false,
          supportedReasoningEfforts: [
            { reasoningEffort: "low", description: "Fast" },
            { reasoningEffort: "ultra", description: "Deepest" }
          ],
          defaultReasoningEffort: "low",
          contextWindow: 1050000,
          inputModalities: ["text", "image"],
          supportsPersonality: true,
          serviceTiers: [{ id: "priority", name: "Fast", description: "Priority processing" }],
          defaultServiceTier: null,
          isDefault: true
        }],
        nextCursor: "page-2"
      });
      return;
    }
    respond(id, {
      data: [{
        id: "gpt-5.6-luna",
        model: "gpt-5.6-luna",
        displayName: "GPT-5.6-Luna",
        description: "Efficient workloads",
        hidden: false,
        supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Balanced" }],
        defaultReasoningEffort: "medium",
        inputModalities: ["text", "image"],
        supportsPersonality: true,
        serviceTiers: [],
        defaultServiceTier: null,
        isDefault: false
      }],
      nextCursor: null
    });
    return;
  }
  if (message.method === "thread/resume") {
    if (!threads.has(params.threadId)) {
      write({ id, error: { message: "no rollout found for thread id " + params.threadId } });
      return;
    }
    respond(id, { thread: { id: params.threadId } });
    return;
  }
  if (message.method === "turn/interrupt") {
    respond(id, {});
    notify("turn/completed", {
      threadId: params.threadId,
      turn: { id: params.turnId, status: "interrupted" }
    });
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
    if (inputText === "stale-before-start") {
      notify("item/completed", {
        threadId,
        turnId: "stale-turn",
        item: { id: "stale-msg", type: "agentMessage", text: "STALE" },
        completedAtMs: Date.now()
      });
      notify("turn/completed", { threadId, turn: { id: "stale-turn", last_agent_message: "STALE" } });
      setTimeout(() => {
        respond(id, { turn: { id: turnId } });
        setTimeout(() => {
          notify("turn/started", { threadId, turn: { id: turnId } });
          notify("item/agentMessage/delta", { threadId, turnId, itemId: "fresh-msg", delta: "Fresh" });
          notify("item/completed", {
            threadId,
            turnId,
            item: { id: "fresh-msg", type: "agentMessage", text: "Fresh" },
            completedAtMs: Date.now()
          });
          notify("turn/completed", { threadId, turn: { id: turnId, last_agent_message: "Fresh" } });
        }, 5);
      }, 200);
      return;
    }
    respond(id, { turn: { id: turnId } });
    setTimeout(() => {
      notify("turn/started", { threadId, turn: { id: turnId } });
      if (inputText === "unsupported-interactive-tool" || inputText === "unsupported-user-input") {
        const requestId = "server-request-1";
        pendingServerRequests.set(requestId, { threadId, turnId });
        write({
          method: inputText === "unsupported-interactive-tool" ? "item/tool/call" : "item/tool/requestUserInput",
          id: requestId,
          params: {
            threadId,
            turnId,
            itemId: "plugin-install-call",
            tool: "request_plugin_install",
            arguments: { plugin_id: "google-drive@openai-curated-remote" }
          }
        });
        return;
      }
      if (inputText === "hang") {
        return;
      }
      if (inputText === "runtime-error") {
        notify("error", { threadId, turnId, message: "sandbox denied", detail: "permission denied opening file" });
        return;
      }
      if (inputText === "retry-then-success") {
        notify("error", {
          threadId,
          turnId,
          message: "Reconnecting... 2/5",
          willRetry: true,
          error: {
            message: "Reconnecting... 2/5",
            additionalDetails: "request timed out"
          }
        });
      }
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
          last: { inputTokens: 12, cachedInputTokens: 3, outputTokens: 7 },
          modelContextWindow: 353400
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
    process.env.CODEX_RUNTIME_DRIVER = "app_server";
    process.env.CODEX_APP_SERVER_BINARY = fakeBinaryPath;
    process.env.CODEX_APP_SERVER_MAX_PROCESSES = "30";
    process.env.CODEX_APP_SERVER_MAX_ACTIVE_TURNS = "2";
    process.env.CODEX_APP_SERVER_TURN_IDLE_TIMEOUT_MS = "";
    process.env.CODEX_APP_SERVER_TURN_MAX_MS = "";
  });

  afterEach(() => {
    shutdownCodexAppServerRuntime("test cleanup");
    restoreEnv();
  });

  it("prefers the project-pinned Codex binary when no override is configured", () => {
    delete process.env.CODEX_APP_SERVER_BINARY;

    expect(resolveCodexAppServerBinaryPath()).toBe(
      path.resolve(process.cwd(), "node_modules/.bin/codex")
    );
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
    expect(events.some((event) => {
      const raw = event.raw as { info?: { model_context_window?: number } } | undefined;
      return event.type === "token_count" && raw?.info?.model_context_window === 353400;
    })).toBe(true);
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

  it("lists every app-server model page with capabilities", async () => {
    const runtime = new CodexRuntime({
      envOverrides: {
        CODEX_HOME: path.join(testTempDir, "codex-home-model-list")
      }
    });

    const catalog = await runtime.listModels();

    expect(catalog.map((model) => model.id)).toEqual(["gpt-5.6-sol", "gpt-5.6-luna"]);
    expect(catalog[0]).toMatchObject({
      defaultReasoningEffort: "low",
      supportedReasoningEfforts: ["low", "ultra"],
      contextLimit: 1_050_000,
      inputModalities: ["text", "image"],
      serviceTiers: [{ id: "priority", label: "Fast" }]
    });
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

  it("keeps the turn alive when app-server emits a retryable reconnect error", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const runtime = new CodexRuntime({
      envOverrides: {
        CODEX_HOME: path.join(testTempDir, "codex-home-retry")
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
    for await (const event of runtime.runStreamed(thread, "retry-then-success")) {
      events.push(event);
    }

    expect(events.filter((event) => event.type === "item.agent_message.delta").map((event) => event.delta).join("")).toBe(
      "Hello"
    );
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(events.some((event) => event.type === "turn.completed")).toBe(true);
    expect(warnSpy).not.toHaveBeenCalledWith("codex app-server turn failed", expect.anything());
    warnSpy.mockRestore();
  });

  it("rejects unsupported interactive tools and lets the turn continue", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const runtime = new CodexRuntime({
      envOverrides: {
        CODEX_HOME: path.join(testTempDir, "codex-home-unsupported-interaction")
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
    for await (const event of runtime.runStreamed(thread, "unsupported-interactive-tool")) {
      events.push(event);
    }

    expect(events.filter((event) => event.type === "item.agent_message.delta").map((event) => event.delta).join(""))
      .toBe("Continued with available information");
    expect(events.some((event) => event.type === "turn.completed")).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      "codex app-server interactive request rejected",
      expect.objectContaining({
        method: "item/tool/call",
        threadId: thread.id,
        reason: "unsupported_channel_interaction"
      })
    );
    warnSpy.mockRestore();
  });

  it("returns an actionable error for unsupported user-input requests and lets the turn continue", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const runtime = new CodexRuntime({
      envOverrides: {
        CODEX_HOME: path.join(testTempDir, "codex-home-unsupported-user-input")
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
    for await (const event of runtime.runStreamed(thread, "unsupported-user-input")) {
      events.push(event);
    }

    expect(events.filter((event) => event.type === "item.agent_message.delta").map((event) => event.delta).join(""))
      .toBe("Continued with available information");
    expect(events.some((event) => event.type === "turn.completed")).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      "codex app-server interactive request rejected",
      expect.objectContaining({
        method: "item/tool/requestUserInput",
        threadId: thread.id,
        reason: "unsupported_channel_interaction"
      })
    );
    warnSpy.mockRestore();
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

  it("drops stale pre-start events from a previous turn before accepting the new turn", async () => {
    const runtime = new CodexRuntime({
      envOverrides: {
        CODEX_HOME: path.join(testTempDir, "codex-home-stale-pre-start")
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
    for await (const event of runtime.runStreamed(thread, "stale-before-start")) {
      events.push(event);
    }

    expect(events.some((event) => JSON.stringify(event.raw).includes("stale-turn"))).toBe(false);
    expect(events.filter((event) => event.type === "item.agent_message.delta").map((event) => event.delta).join("")).toBe(
      "Fresh"
    );
    expect(
      events.some((event) => {
        const raw = event.raw as { turn_id?: string; last_agent_message?: string } | undefined;
        return event.type === "turn.completed" && raw?.last_agent_message === "Fresh";
      })
    ).toBe(true);
  });

  it("fails and releases a turn when the app-server stops emitting events", async () => {
    process.env.CODEX_APP_SERVER_TURN_IDLE_TIMEOUT_MS = "30";
    process.env.CODEX_APP_SERVER_TURN_MAX_MS = "500";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const runtime = new CodexRuntime({
      envOverrides: {
        CODEX_HOME: path.join(testTempDir, "codex-home-timeout")
      }
    });
    const thread = await runtime.startThreadWithOptions({
      model: "gpt-5.5",
      reasoningEffort: "high",
      workspace: testTempDir,
      codexRunConfig: {
        sandboxMode: "danger-full-access",
        approvalPolicy: "never"
      }
    });

    await expect(async () => {
      for await (const _event of runtime.runStreamed(thread, "hang")) {
        // drain events until timeout
      }
    }).rejects.toThrow(/idle timed out|max runtime/);
    expect(warnSpy).toHaveBeenCalledWith(
      "codex app-server turn failed",
      expect.objectContaining({
        category: "turn_timeout"
      })
    );
    warnSpy.mockRestore();
  });

  it("aborts an in-flight app-server turn when the client signal is cancelled", async () => {
    process.env.CODEX_APP_SERVER_TURN_IDLE_TIMEOUT_MS = "500";
    process.env.CODEX_APP_SERVER_TURN_MAX_MS = "1000";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const runtime = new CodexRuntime({
      envOverrides: {
        CODEX_HOME: path.join(testTempDir, "codex-home-abort")
      }
    });
    const thread = await runtime.startThreadWithOptions({
      model: "gpt-5.5",
      reasoningEffort: "high",
      workspace: testTempDir,
      codexRunConfig: {
        sandboxMode: "danger-full-access",
        approvalPolicy: "never"
      }
    });
    const abortController = new AbortController();

    await expect(async () => {
      for await (const event of runtime.runStreamed(thread, "hang", { signal: abortController.signal })) {
        if (event.type === "turn.started") {
          abortController.abort();
        }
      }
    }).rejects.toThrow(/aborted by client/);
    expect(warnSpy).toHaveBeenCalledWith(
      "codex app-server turn failed",
      expect.objectContaining({
        category: "client_aborted"
      })
    );
    expect(warnSpy).not.toHaveBeenCalledWith(
      "codex app-server turn interrupt failed",
      expect.anything()
    );
    warnSpy.mockRestore();
  });
});
