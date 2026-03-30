/* eslint-disable @typescript-eslint/no-explicit-any */
import { Codex } from "@openai/codex-sdk";
import type { ReasoningEffort } from "./model-config.js";

export type CodexStreamEvent = {
  type: string;
  delta?: string;
  text?: string;
  raw?: unknown;
};

type CodexRuntimeOptions = {
  baseUrl?: string;
  apiKey?: string;
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

  constructor(options: CodexRuntimeOptions = {}) {
    this.codex = new Codex({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey
    });
  }

  async startThread(): Promise<any> {
    return await Promise.resolve(this.codex.startThread());
  }

  async startThreadWithOptions(options: {
    model: string;
    reasoningEffort: ReasoningEffort;
    workspace: string;
    codexRunConfig?: Record<string, unknown>;
  }): Promise<any> {
    const threadOptions: Record<string, unknown> = {
      model: options.model,
      workingDirectory: options.workspace,
      skipGitRepoCheck: true,
      modelReasoningEffort: options.reasoningEffort,
      ...(options.codexRunConfig || {})
    };
    return await Promise.resolve(this.codex.startThread(threadOptions));
  }

  async *runStreamed(
    thread: any,
    message: string
  ): AsyncGenerator<CodexStreamEvent> {
    const { events } = await thread.runStreamed(message);
    const textState = new Map<string, string>();
    for await (const event of events) {
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
    const thread = this.codex.startThread({
      model: options.model,
      modelReasoningEffort: options.reasoningEffort,
      workingDirectory: process.cwd(),
      skipGitRepoCheck: true
    });
    await thread.run("Reply with the single word OK.");
  }
}
