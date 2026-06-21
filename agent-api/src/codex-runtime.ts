/* eslint-disable @typescript-eslint/no-explicit-any */
import { Codex } from "./patched-codex-sdk.js";
import type { ReasoningEffort } from "./model-config.js";
import { CodexAppServerRuntime, isAppServerRuntimeEnabled } from "./codex-app-server-runtime.js";

export type CodexStreamEvent = {
  type: string;
  delta?: string;
  text?: string;
  raw?: unknown;
};

export type CodexRunStreamOptions = {
  signal?: AbortSignal;
};

export type CodexRuntimeOptions = {
  baseUrl?: string;
  apiKey?: string;
  config?: Record<string, any>;
  envOverrides?: Record<string, string>;
};

function pickText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const obj = value as Record<string, unknown>;
  const direct = obj.text;
  if (typeof direct === "string") return direct;
  const delta = obj.delta;
  if (typeof delta === "string") return delta;
  const content = obj.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((it) => {
        if (typeof it === "string") return it;
        if (it && typeof it === "object" && typeof (it as Record<string, unknown>).text === "string") {
          return String((it as Record<string, unknown>).text);
        }
        return "";
      })
      .filter(Boolean)
      .join("");
  }
  return "";
}

function normalizeEvent(event: any): CodexStreamEvent {
  const eventType = typeof event?.type === "string" ? event.type : "unknown";
  const delta = pickText(event?.delta ?? event?.textDelta ?? event?.messageDelta);
  const text = pickText(event?.text ?? event?.message ?? event?.content ?? event?.output);
  return {
    type: eventType,
    delta: delta || undefined,
    text: text || undefined,
    raw: event
  };
}

function normalizeAgentTextEvent(event: any, textState: Map<string, string>): CodexStreamEvent | null {
  if (!event || typeof event !== "object") return null;
  const type = String(event.type || "");
  if (!type.startsWith("item.")) return null;
  const item = event.item;
  if (!item || typeof item !== "object") return null;
  const itemType = String(item.type || "");
  if (itemType !== "agent_message") return null;

  const itemId = String(item.id || "");
  const current = typeof item.text === "string" ? item.text : "";
  if (!itemId || !current) {
    return {
      type,
      text: current || undefined,
      raw: event
    };
  }

  const prev = textState.get(itemId) || "";
  let delta = current;
  if (prev && current.startsWith(prev)) {
    delta = current.slice(prev.length);
  }
  textState.set(itemId, current);

  return {
    type,
    delta: delta || undefined,
    text: current,
    raw: event
  };
}

export class CodexRuntime {
  private readonly codex: any;
  private readonly appServerRuntime: CodexAppServerRuntime | undefined;

  constructor(options: CodexRuntimeOptions = {}) {
    if (isAppServerRuntimeEnabled()) {
      this.codex = undefined;
      this.appServerRuntime = new CodexAppServerRuntime(options);
      return;
    }
    const env =
      options.envOverrides && Object.keys(options.envOverrides).length > 0
        ? Object.fromEntries(
            Object.entries({
              ...Object.fromEntries(
                Object.entries(process.env).flatMap(([key, value]) => (value === undefined ? [] : [[key, value]]))
              ),
              ...options.envOverrides
            }).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : []))
          )
        : undefined;
    this.codex = new Codex({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      config: options.config,
      env
    });
  }

  async startThread(): Promise<any> {
    if (this.appServerRuntime) {
      throw new Error("startThread() without options is not supported by the app-server runtime");
    }
    return await Promise.resolve(this.codex.startThread());
  }

  async startThreadWithOptions(options: {
    model: string;
    reasoningEffort: ReasoningEffort;
    workspace: string;
    codexRunConfig?: Record<string, unknown>;
  }): Promise<any> {
    if (this.appServerRuntime) {
      return await this.appServerRuntime.startThreadWithOptions(options);
    }
    return await Promise.resolve(this.codex.startThread(this.buildThreadOptions(options)));
  }

  async resumeThreadWithOptions(options: {
    threadId: string;
    model: string;
    reasoningEffort: ReasoningEffort;
    workspace: string;
    codexRunConfig?: Record<string, unknown>;
  }): Promise<any> {
    if (this.appServerRuntime) {
      return await this.appServerRuntime.resumeThreadWithOptions(options);
    }
    return await Promise.resolve(this.codex.resumeThread(options.threadId, this.buildThreadOptions(options)));
  }

  async *runStreamed(
    thread: any,
    message: string,
    options: CodexRunStreamOptions = {}
  ): AsyncGenerator<CodexStreamEvent> {
    if (options.signal?.aborted) {
      throw new Error("Codex runtime request aborted");
    }
    if (this.appServerRuntime) {
      yield* this.appServerRuntime.runStreamed(thread, message, options);
      return;
    }
    const { events } = await thread.runStreamed(message);
    const textState = new Map<string, string>();
    for await (const event of events) {
      if (options.signal?.aborted) {
        throw new Error("Codex runtime request aborted");
      }
      const textEvent = normalizeAgentTextEvent(event, textState);
      if (textEvent) {
        yield textEvent;
        continue;
      }
      yield normalizeEvent(event);
    }
  }

  async validateProvider(options: {
    model: string;
    reasoningEffort: ReasoningEffort;
  }): Promise<void> {
    if (this.appServerRuntime) {
      await this.appServerRuntime.validateProvider(options);
      return;
    }
    const thread = this.codex.startThread({
      model: options.model,
      modelReasoningEffort: options.reasoningEffort,
      workingDirectory: process.cwd(),
      skipGitRepoCheck: true
    });
    await thread.run("Reply with the single word OK.");
  }

  private buildThreadOptions(options: {
    model: string;
    reasoningEffort: ReasoningEffort;
    workspace: string;
    codexRunConfig?: Record<string, unknown>;
  }): Record<string, unknown> {
    return {
      model: options.model,
      workingDirectory: options.workspace,
      skipGitRepoCheck: true,
      modelReasoningEffort: options.reasoningEffort,
      ...(options.codexRunConfig || {})
    };
  }
}
