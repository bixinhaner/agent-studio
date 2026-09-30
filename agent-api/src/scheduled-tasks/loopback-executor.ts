import { randomUUID } from "node:crypto";

export type ScheduledTurnInput = {
  userId: string;
  organizationId: string;
  title: string;
  prompt: string;
  folderId?: string | null;
  modeId?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
  runConfig?: Record<string, unknown>;
  skillIds?: string[];
  locale: "en" | "zh-CN";
  timeoutMs?: number;
};

export type ScheduledTurnResult = {
  threadId?: string;
  status: "succeeded" | "failed";
  answerText?: string;
  artifactCount: number;
  error?: string;
};

type LoopbackExecutorOptions = {
  baseUrl: string;
  /** Mints a short-lived `name=value` session cookie for the task owner. */
  createSessionCookie(userId: string, organizationId: string): string;
  fetchImpl?: typeof fetch;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function detailFromPayload(payload: unknown, fallback: string): string {
  const record = asRecord(payload);
  const detail = record?.detail ?? record?.message ?? record?.error;
  return typeof detail === "string" && detail.trim() ? detail.trim() : fallback;
}

export function extractMessageText(message: unknown): string {
  const record = asRecord(message);
  const content = record?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const item = asRecord(part);
      return item?.type === "text" && typeof item.text === "string" ? item.text : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

/** Parses a text/event-stream body into `{ event, data }` records. */
export async function* readSseEvents(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<{ event: string; data: unknown }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const flush = function* (chunk: string) {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of chunk.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) return;
    const raw = dataLines.join("\n");
    let data: unknown = raw;
    try {
      data = JSON.parse(raw);
    } catch {
      // Keep raw text payloads as-is.
    }
    yield { event, data };
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      yield* flush(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
  }
  if (buffer.trim()) yield* flush(buffer);
}

/**
 * Executes a scheduled task by replaying the same HTTP sequence the portal
 * uses (create thread → persist user message → ensure session → stream).
 * Going through the real routes keeps quota, security review, skills,
 * workspace sync and message persistence identical to an interactive turn.
 */
export function createLoopbackScheduledTurnExecutor(options: LoopbackExecutorOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;

  return async function executeScheduledTurn(input: ScheduledTurnInput): Promise<ScheduledTurnResult> {
    const cookie = options.createSessionCookie(input.userId, input.organizationId);
    const headers = {
      "content-type": "application/json",
      accept: "application/json",
      cookie,
      "x-agent-studio-scheduled-task": "1"
    };
    const call = async (path: string, init: { method: string; body?: unknown }) => {
      const response = await fetchImpl(`${options.baseUrl}${path}`, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body)
      });
      const payload = await response.json().catch(() => undefined);
      if (!response.ok) {
        throw new Error(detailFromPayload(payload, `${init.method} ${path} failed (${response.status})`));
      }
      return asRecord(payload) ?? {};
    };

    let threadId: string | undefined;
    try {
      const codexRunConfig = {
        ...(input.runConfig ?? {}),
        ...(input.modeId ? { mode: input.modeId } : {})
      };
      const created = await call("/api/threads", {
        method: "POST",
        body: {
          title: input.title,
          folder_id: input.folderId ?? undefined,
          model: input.model ?? undefined,
          reasoning_effort: input.reasoningEffort ?? undefined,
          codex_run_config: codexRunConfig,
          start_session: false
        }
      });
      threadId = String(asRecord(created.thread)?.id ?? "");
      if (!threadId) throw new Error("Thread creation returned no id");
      const encodedThreadId = encodeURIComponent(threadId);

      const userMessageId = `sched-${randomUUID()}`;
      const clientRunId = randomUUID();
      const userMessage = {
        id: userMessageId,
        role: "user",
        content: [{ type: "text", text: input.prompt }],
        attachments: [],
        createdAt: new Date().toISOString(),
        metadata: { custom: { scheduledTask: true } }
      };
      await call(`/api/threads/${encodedThreadId}/messages`, {
        method: "POST",
        body: {
          parent_id: null,
          message: userMessage,
          run_config: { channel: "portal", pendingUserMessage: true }
        }
      });

      const selectedSkillIds = input.skillIds?.length ? input.skillIds.slice(0, 20) : undefined;
      const ensured = await call(`/api/threads/${encodedThreadId}/session`, {
        method: "POST",
        body: {
          model: input.model ?? undefined,
          reasoning_effort: input.reasoningEffort ?? undefined,
          selected_skill_ids: selectedSkillIds,
          codex_run_config: codexRunConfig,
          client_run_id: clientRunId,
          client_user_message_id: userMessageId,
          portal_locale: input.locale
        }
      });
      const sessionId = String(asRecord(ensured.session)?.session_id ?? "");
      if (!sessionId) throw new Error("Session initialization returned no id");

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 45 * 60_000);
      let streamError: string | undefined;
      let sawDone = false;
      try {
        const response = await fetchImpl(`${options.baseUrl}/api/chat/stream`, {
          method: "POST",
          headers: { ...headers, accept: "text/event-stream" },
          body: JSON.stringify({
            session_id: sessionId,
            client_run_id: clientRunId,
            thread_id: threadId,
            user_message_id: userMessageId,
            client_user_message_id: userMessageId,
            parent_id: null,
            user_message: userMessage,
            display_message: input.prompt,
            selected_skill_ids: selectedSkillIds,
            portal_locale: input.locale,
            message: input.prompt
          }),
          signal: controller.signal
        });
        if (!response.ok || !response.body) {
          const payload = await response.json().catch(() => undefined);
          throw new Error(detailFromPayload(payload, `Chat stream failed (${response.status})`));
        }
        for await (const { event, data } of readSseEvents(response.body)) {
          if (event === "error") streamError = detailFromPayload(data, "Run failed");
          if (event === "done") sawDone = true;
        }
      } finally {
        clearTimeout(timer);
      }

      const history = await call(`/api/threads/${encodedThreadId}/messages`, { method: "GET" });
      const messages = Array.isArray(history.messages) ? history.messages : [];
      const lastAssistant = [...messages]
        .map((item) => asRecord(asRecord(item)?.message))
        .reverse()
        .find((message) => message?.role === "assistant");
      const answerText = extractMessageText(lastAssistant);
      const artifacts = await call(`/api/threads/${encodedThreadId}/artifacts`, { method: "GET" }).catch(() => ({}));
      const artifactCount = Array.isArray((artifacts as Record<string, unknown>).artifacts)
        ? ((artifacts as Record<string, unknown>).artifacts as unknown[]).length
        : 0;

      if (streamError || (!sawDone && !answerText)) {
        return {
          threadId,
          status: "failed",
          answerText,
          artifactCount,
          error: streamError ?? "The run ended without a response"
        };
      }
      return { threadId, status: "succeeded", answerText, artifactCount };
    } catch (error) {
      return {
        threadId,
        status: "failed",
        artifactCount: 0,
        error: error instanceof Error ? (error.name === "AbortError" ? "The run timed out" : error.message) : String(error)
      };
    }
  };
}
