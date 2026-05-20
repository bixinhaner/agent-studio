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
    "Use the following Zendesk ticket context to decide the next action.",
    `Preferred response mode: ${settings.responseMode}`,
    `Fallback mode: ${settings.fallbackMode}`,
    "",
    "Return JSON in exactly this shape:",
    "{",
    '  "decision": "public_reply" | "internal_note" | "handoff",',
    '  "body": "Customer-facing public reply. Leave it empty when the decision is not public_reply.",',
    '  "internalNote": "Internal support note. Leave it empty when there is nothing to add.",',
    '  "confidence": 0.0,',
    '  "reasons": ["Short reason 1", "Short reason 2"]',
    "}",
    "",
    "Rules:",
    "1. Choose handoff or internal_note when the available context is insufficient, the answer would create a high-risk commitment, or human verification is required.",
    "2. The body for public_reply must be concise and useful. Do not use marketing language, and do not mention that you are looking at a ticketing system.",
    "3. internalNote may include a suggested reply, missing information, risk notes, and recommended next steps for the support team.",
    "4. If the customer wrote in Chinese, reply in Chinese. Otherwise, follow the language of the customer's latest message whenever possible.",
    "5. If comments include attachments with status downloaded, read the file at local_path when it is relevant. Treat images and screenshots as usable evidence.",
    "6. Never expose local paths, internal directories, manifest paths, API tokens, secrets, or implementation details in a public reply.",
    "7. Output only the JSON object. Do not output markdown, code fences, explanations, or any extra text."
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
    reasons: ["The model did not return valid JSON, so the output was downgraded to an internal note."]
  };
}

export function buildInternalNoteFromDecision(decision: ZendeskAgentDecision): string {
  const lines: string[] = [];
  if (decision.decision === "handoff") {
    lines.push("AI recommends human handoff.");
  } else if (decision.decision === "internal_note") {
    lines.push("AI generated an internal note.");
  } else {
    lines.push("AI suggested the following public reply, but the current configuration records it as an internal note.");
  }

  if (decision.confidence !== undefined) {
    lines.push(`Confidence: ${Math.round(decision.confidence * 100)}%`);
  }

  if (decision.reasons && decision.reasons.length > 0) {
    lines.push(`Reasons: ${decision.reasons.join("; ")}`);
  }

  if (decision.body) {
    lines.push("");
    lines.push("Suggested public reply:");
    lines.push(decision.body);
  }

  if (decision.internalNote) {
    lines.push("");
    lines.push("Internal note:");
    lines.push(decision.internalNote);
  }

  return trimBlock(lines.join("\n"));
}
