import type {
  ZendeskAgentDecision,
  ZendeskCommentPayload,
  ZendeskIntegrationSettings,
  ZendeskTicketContext
} from "./types.js";

function trimBlock(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function formatComment(comment: ZendeskCommentPayload, requesterId?: number): string {
  const author = comment.authorId === requesterId ? "requester" : `user:${comment.authorId || "unknown"}`;
  const visibility = comment.public ? "public" : "internal";
  const createdAt = comment.createdAt || "";
  const attachments = comment.attachments ?? [];
  const lines = [
    `- comment_id: ${comment.id}`,
    `  author: ${author}`,
    `  visibility: ${visibility}`,
    `  created_at: ${createdAt}`,
    `  body: |`,
    ...trimBlock(comment.body || "")
      .split("\n")
      .map((line) => `    ${line}`)
  ];

  if (attachments.length > 0) {
    lines.push("  attachments:");
    for (const attachment of attachments) {
      lines.push(`    - file_name: ${attachment.fileName}`);
      lines.push(`      content_type: ${attachment.contentType || ""}`);
      lines.push(`      size_bytes: ${attachment.size ?? ""}`);
      lines.push(`      inline: ${attachment.inline ? "true" : "false"}`);
      lines.push(`      status: ${attachment.downloadStatus || "metadata_only"}`);
      if (attachment.relativePath) {
        lines.push(`      local_path: ${attachment.relativePath}`);
      }
      if (attachment.downloadReason) {
        lines.push(`      reason: ${attachment.downloadReason}`);
      }
    }
  }

  return lines.join("\n");
}

export function buildZendeskAgentPrompt(
  context: ZendeskTicketContext,
  settings: ZendeskIntegrationSettings
): string {
  const latestComments = context.comments
    .slice(0, settings.maxCommentHistory)
    .map((item) => formatComment(item, context.ticket.requesterId))
    .join("\n");

  const instructions = [
    settings.systemPrompt,
    "",
    "请基于以下 Zendesk 工单上下文完成判断。",
    `优先回复模式: ${settings.responseMode}`,
    `兜底模式: ${settings.fallbackMode}`,
    "",
    "返回 JSON，格式必须为：",
    "{",
    '  "decision": "public_reply" | "internal_note" | "handoff",',
    '  "body": "给客户的公开回复；如果不是公开回复，也可以为空字符串",',
    '  "internalNote": "给内部客服的说明；如果没有可为空字符串",',
    '  "confidence": 0.0,',
    '  "reasons": ["简短原因1", "简短原因2"]',
    "}",
    "",
    "规则：",
    "1. 如果资料不足、存在高风险承诺、或需要人工核实，选择 handoff 或 internal_note。",
    "2. public_reply 的 body 应简洁，避免营销口吻，避免提及你在“看工单系统”。",
    "3. internalNote 可以包含建议回复、缺失信息、人工处理建议。",
    "4. 如果 customer 使用中文，优先中文回复；否则尽量沿用客户最新消息语言。",
    "5. 如果评论包含 attachments 且 status 为 downloaded，请在需要时读取 local_path 指向的本地文件；图片和截图也按附件理解。",
    "6. 不要在公开回复中暴露本地路径、内部目录、manifest 路径或系统实现细节。",
    "7. 除 JSON 外不要输出任何额外文本。"
  ];

  const ticketContext = [
    "ticket:",
    `  id: ${context.ticket.id}`,
    `  subject: ${context.ticket.subject || ""}`,
    `  status: ${context.ticket.status || ""}`,
    `  priority: ${context.ticket.priority || ""}`,
    `  requester_id: ${context.ticket.requesterId || ""}`,
    `  updated_at: ${context.ticket.updatedAt || ""}`,
    `  tags: ${(context.ticket.tags || []).join(", ")}`,
    "description: |",
    ...trimBlock(context.ticket.description || "")
      .split("\n")
      .map((line) => `  ${line}`),
    "",
    "recent_comments:",
    latestComments || "  (none)"
  ];

  return `${instructions.join("\n")}\n\n${ticketContext.join("\n")}`;
}

function tryParseJson(text: string): ZendeskAgentDecision | null {
  const cleaned = text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  const candidates = [cleaned];
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    candidates.push(cleaned.slice(start, end + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const decisionRaw = String(parsed.decision || "").trim();
      if (!["public_reply", "internal_note", "handoff"].includes(decisionRaw)) continue;
      const body = typeof parsed.body === "string" ? trimBlock(parsed.body) : "";
      const internalNote =
        typeof parsed.internalNote === "string"
          ? trimBlock(parsed.internalNote)
          : typeof parsed.internal_note === "string"
            ? trimBlock(String(parsed.internal_note))
            : "";
      const confidence = Number(parsed.confidence);
      const reasons = Array.isArray(parsed.reasons)
        ? parsed.reasons.map((item) => String(item || "").trim()).filter(Boolean)
        : [];
      return {
        decision: decisionRaw as ZendeskAgentDecision["decision"],
        body,
        internalNote,
        confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : undefined,
        reasons
      };
    } catch {
      // continue
    }
  }

  return null;
}

export function parseZendeskAgentDecision(text: string): ZendeskAgentDecision {
  const parsed = tryParseJson(text);
  if (parsed) {
    return parsed;
  }
  return {
    decision: "internal_note",
    body: "",
    internalNote: trimBlock(text),
    confidence: undefined,
    reasons: ["模型未按 JSON 输出，已降级为内部备注"]
  };
}

export function buildInternalNoteFromDecision(decision: ZendeskAgentDecision): string {
  const lines: string[] = [];
  if (decision.decision === "handoff") {
    lines.push("AI 建议转人工处理。");
  } else if (decision.decision === "internal_note") {
    lines.push("AI 生成了内部备注。");
  } else {
    lines.push("AI 建议以下公开回复，当前配置为内部备注模式。");
  }

  if (decision.confidence !== undefined) {
    lines.push(`置信度: ${Math.round(decision.confidence * 100)}%`);
  }

  if (decision.reasons && decision.reasons.length > 0) {
    lines.push(`原因: ${decision.reasons.join("；")}`);
  }

  if (decision.body) {
    lines.push("");
    lines.push("建议公开回复:");
    lines.push(decision.body);
  }

  if (decision.internalNote) {
    lines.push("");
    lines.push("内部说明:");
    lines.push(decision.internalNote);
  }

  return trimBlock(lines.join("\n"));
}
