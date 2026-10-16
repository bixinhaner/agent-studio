import { asRecord, detailFromUnknown, shorten } from "./portal-value-utils";
import { type ProcessData, type TimelineRow, type TurnUsage } from "./portal-types";
import {
  RUNNING_STAGE_ANSWER_TEXT,
  RUNNING_STAGE_CONTEXT_TEXT,
  RUNNING_STAGE_IMAGE_TEXT,
  RUNNING_STAGE_RESULT_TEXT
} from "./portal-constants";

export function timelineKindLabel(kind: TimelineRow["kind"]): string {
  if (kind === "reasoning") return "Reasoning";
  if (kind === "tool") return "Tool";
  if (kind === "source") return "Source";
  if (kind === "meta") return "Setup";
  if (kind === "done") return "Done";
  if (kind === "error") return "Error";
  if (kind === "debug") return "Debug";
  return "Step";
}

export function toTokenCount(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

export function parseTurnUsage(value: unknown): TurnUsage | null {
  const usage = asRecord(value);
  if (!usage) return null;
  const inputTokens = toTokenCount(usage.input_tokens);
  const cachedInputTokens = toTokenCount(usage.cached_input_tokens);
  const outputTokens = toTokenCount(usage.output_tokens);
  if (inputTokens === null || cachedInputTokens === null || outputTokens === null) return null;
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens
  };
}

export function formatCompactTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    const inM = tokens / 1_000_000;
    return `${inM.toFixed(inM < 10 ? 1 : 0).replace(/\.0$/, "")}m`;
  }
  if (tokens >= 1_000) {
    const inK = tokens / 1_000;
    return `${inK.toFixed(inK < 10 ? 1 : 0).replace(/\.0$/, "")}k`;
  }
  return String(tokens);
}

export function normalizedToolIdentity(item: Record<string, unknown> | null): string {
  if (!item) return "";
  return [
    item.server,
    item.tool,
    item.name,
    item.model,
    item.title
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

export function isImageGenerationItem(itemType: string, item: Record<string, unknown> | null): boolean {
  if (
    itemType === "image_generation" ||
    itemType === "image_generation_call" ||
    itemType === "imageGeneration" ||
    itemType === "image_generation_end"
  ) {
    return true;
  }
  const identity = normalizedToolIdentity(item);
  const itemOwnType = typeof item?.type === "string" ? item.type : "";
  if (itemOwnType === "image_generation_call" || itemOwnType === "imageGeneration") return true;
  if (!identity) return false;
  if (/(^|\b|_)(imagegen|image_gen|image-generation|image_generation|image-generation-call|image_generation_call|gpt-image|dall-e|dalle)(\b|_|$)/.test(identity)) {
    return true;
  }
  return (
    itemType === "mcp_tool_call" &&
    /\b(generate|create|render|edit)\b/.test(identity) &&
    /\b(image|picture|illustration|photo)\b/.test(identity)
  );
}

export function isImageGenerationStageText(value: string): boolean {
  return value.trim() === RUNNING_STAGE_IMAGE_TEXT;
}

export function stageTextForCodexItem(
  itemType: string,
  lifecycle: "started" | "completed",
  item: Record<string, unknown> | null
): string {
  if (lifecycle === "started") {
    if (isImageGenerationItem(itemType, item)) return RUNNING_STAGE_IMAGE_TEXT;
    if (itemType === "reasoning") return RUNNING_STAGE_CONTEXT_TEXT;
    if (itemType === "contextCompaction") return "Context window is full. Compressing context.";
    if (itemType === "command_execution") return "Running workspace operation.";
    if (itemType === "mcp_tool_call") return "Using Tool.";
    if (itemType === "web_search") return "Searching the web.";
    if (itemType === "todo_list" || itemType === "plan") return "Planning the work.";
    if (itemType === "file_change") return "Preparing file updates.";
    if (itemType === "image_view" || itemType === "imageView") return "Inspecting image.";
    if (itemType === "collabAgentToolCall" || itemType === "subAgentActivity") return "Working with another agent.";
    if (itemType === "sleep") return "Waiting before continuing.";
    if (itemType === "agent_message") return RUNNING_STAGE_ANSWER_TEXT;
    if (itemType === "error") return "Request needs attention.";
    return RUNNING_STAGE_CONTEXT_TEXT;
  }

  if (isImageGenerationItem(itemType, item)) return RUNNING_STAGE_RESULT_TEXT;
  if (itemType === "reasoning") return RUNNING_STAGE_CONTEXT_TEXT;
  if (itemType === "contextCompaction") return "Context compressed. Continuing with your request.";
  if (itemType === "command_execution") return "Workspace operation completed.";
  if (itemType === "mcp_tool_call") return "Tool step completed.";
  if (itemType === "web_search") return "Search completed.";
  if (itemType === "todo_list" || itemType === "plan") return "Plan updated.";
  if (itemType === "file_change") return "Files updated.";
  if (itemType === "image_view" || itemType === "imageView") return "Image inspected.";
  if (itemType === "collabAgentToolCall" || itemType === "subAgentActivity") return "Agent work updated.";
  if (itemType === "sleep") return "Continuing your request.";
  if (itemType === "agent_message") return RUNNING_STAGE_ANSWER_TEXT;
  if (itemType === "error") return "Request needs attention.";
  return RUNNING_STAGE_RESULT_TEXT;
}

export function itemTextDetail(item: Record<string, unknown> | null, max = 800): string {
  const text = typeof item?.text === "string" ? item.text.trim() : "";
  return text ? shorten(text, max) : "";
}

export function imageGenerationDetail(item: Record<string, unknown> | null): string {
  const revisedPrompt =
    (typeof item?.revised_prompt === "string" ? item.revised_prompt.trim() : "") ||
    (typeof item?.revisedPrompt === "string" ? item.revisedPrompt.trim() : "");
  return revisedPrompt ? shorten(revisedPrompt, 800) : "";
}

export function todoListDetail(item: Record<string, unknown> | null): string {
  const items = Array.isArray(item?.items) ? item.items : [];
  return items
    .slice(0, 20)
    .map((entry) => {
      const row = asRecord(entry);
      if (!row) return "";
      const text = typeof row.text === "string" ? row.text.trim() : "";
      if (!text) return "";
      return `${row.completed === true ? "[x]" : "[ ]"} ${text}`;
    })
    .filter(Boolean)
    .join("\n");
}

export function codexLifecycleProcessTrace(
  itemType: string,
  lifecycle: "started" | "completed",
  item: Record<string, unknown> | null
): Pick<ProcessData, "kind" | "title" | "detail"> | null | undefined {
  const isStarted = lifecycle === "started";
  if (itemType === "user_message" || itemType === "hookPrompt") return null;

  if (itemType === "contextCompaction") {
    return {
      kind: "meta",
      title: isStarted ? "Context window is full. Compressing context." : "Context compressed"
    };
  }

  if (isImageGenerationItem(itemType, item)) {
    return {
      kind: "process",
      title: isStarted ? "Generating image" : "Image generated",
      detail: isStarted ? undefined : imageGenerationDetail(item)
    };
  }

  if (itemType === "image_view" || itemType === "imageView") {
    return {
      kind: "process",
      title: isStarted ? "Inspecting image" : "Image inspected"
    };
  }

  if (itemType === "plan" || itemType === "todo_list") {
    return {
      kind: "process",
      title: isStarted ? "Planning the work" : "Plan updated",
      detail: todoListDetail(item) || itemTextDetail(item)
    };
  }

  if (itemType === "command_execution") {
    const command = typeof item?.command === "string" ? item.command.trim() : "";
    return {
      kind: "process",
      title: isStarted ? "Running workspace operation" : "Workspace operation completed",
      detail: command ? `$ ${command}` : undefined
    };
  }

  if (itemType === "mcp_tool_call") {
    const server = typeof item?.server === "string" ? item.server.trim() : "";
    const tool = typeof item?.tool === "string" ? item.tool.trim() : "";
    return {
      kind: "process",
      title: isStarted ? "Using Tool" : "Tool step completed",
      detail: [server ? `server: ${server}` : "", tool ? `tool: ${tool}` : ""].filter(Boolean).join("\n") || undefined
    };
  }

  if (itemType === "web_search") {
    const query = typeof item?.query === "string" ? item.query.trim() : "";
    return {
      kind: "process",
      title: isStarted ? "Searching the web" : "Search completed",
      detail: query || undefined
    };
  }

  if (itemType === "file_change") {
    return {
      kind: "process",
      title: isStarted ? "Preparing file updates" : "Files updated"
    };
  }

  if (itemType === "collabAgentToolCall" || itemType === "subAgentActivity") {
    return {
      kind: "process",
      title: isStarted ? "Working with another agent" : "Agent work updated"
    };
  }

  if (itemType === "enteredReviewMode" || itemType === "exitedReviewMode") {
    return {
      kind: "process",
      title: "Review mode updated"
    };
  }

  if (itemType === "sleep") {
    return {
      kind: "meta",
      title: "Waiting before continuing"
    };
  }

  return undefined;
}

export function parseCrestActionResult(result: unknown): Record<string, unknown> | null {
  const direct = asRecord(result);
  const content = Array.isArray(direct?.content) ? direct.content : [];
  const firstText = content
    .map((item) => asRecord(item))
    .find((item) => item?.type === "text" && typeof item.text === "string")?.text;
  if (typeof firstText === "string") {
    try {
      return asRecord(JSON.parse(firstText));
    } catch {
      return null;
    }
  }
  return direct;
}

export function crestActionTrace(
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
  errMsg: string
): { title: string; detail: string } | null {
  if (!toolName.includes("crest_crm.") && !toolName.includes("crest.actions.")) return null;
  const actionId = typeof args.actionId === "string" ? args.actionId : "";
  const payload = parseCrestActionResult(result);
  const title = typeof payload?.title === "string" ? payload.title : actionId || "Crest action";
  if (errMsg) {
    return {
      title: `Crest CRM · ${title}`,
      detail: `needs attention: ${shorten(errMsg, 600)}`
    };
  }
  const summary = typeof payload?.summary === "string" ? payload.summary : "";
  const warnings = Array.isArray(payload?.warnings)
    ? payload.warnings.filter((item): item is string => typeof item === "string")
    : [];
  const requiresConfirmation = payload?.requiresConfirmation === true;
  const confirmationToken = typeof payload?.confirmationToken === "string" ? payload.confirmationToken : "";
  const idempotencyKey = typeof payload?.idempotencyKey === "string" ? payload.idempotencyKey : "";
  const auditId = typeof payload?.auditId === "string" ? payload.auditId : "";
  const affectedResources = Array.isArray(payload?.affectedResources)
    ? payload.affectedResources.map((item) => detailFromUnknown(item)).filter(Boolean)
    : [];
  const lines = [
    actionId ? `action: ${actionId}` : "",
    summary,
    affectedResources.length ? `affected:\n${affectedResources.map((item) => `- ${item}`).join("\n")}` : "",
    warnings.length ? `notes:\n${warnings.map((item) => `- ${item}`).join("\n")}` : "",
    confirmationToken ? "confirmation: required" : "",
    idempotencyKey ? "idempotency: ready" : "",
    auditId ? `audit: ${auditId}` : ""
  ].filter(Boolean);
  return {
    title: requiresConfirmation ? `Crest CRM · Preview ${title}` : `Crest CRM · ${title}`,
    detail: lines.join("\n")
  };
}
