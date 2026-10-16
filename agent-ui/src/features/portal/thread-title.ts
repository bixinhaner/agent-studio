import { type ThreadMessage } from "@assistant-ui/react";
import { inlineReferencePlainText } from "./inline-references";
import { asRecord } from "./portal-value-utils";

export function messageTextForTitle(messages: readonly ThreadMessage[]): string {
  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i];
    if (!msg || msg.role !== "user") continue;
    const text = msg.content
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        if (part.type !== "text") return "";
        return typeof part.text === "string" ? part.text : "";
      })
      .filter(Boolean)
      .join(" ")
      .trim();
    if (text) return text;
  }
  return "";
}

export function guessThreadTitleFromText(value: string): string {
  const text = value
    .replace(/<uploaded_file[\s\S]*?<\/uploaded_file>/gi, "uploaded file")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "New conversation";
  return text.length <= 22 ? text : `${text.slice(0, 22)}...`;
}

export function isPlaceholderThreadTitle(value: string | undefined): boolean {
  const title = String(value || "").trim();
  return !title || title === "New conversation";
}

export function guessThreadTitle(messages: readonly ThreadMessage[]): string {
  return guessThreadTitleFromText(messageTextForTitle(messages));
}

export function userTextFromUnknownMessage(message: unknown): string {
  const obj = asRecord(message);
  if (!obj) return "";
  if (obj.role !== "user") return "";

  const content = Array.isArray(obj.content) ? obj.content : [];
  const text = content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      if ((part as { type?: unknown }).type !== "text") return "";
      return typeof (part as { text?: unknown }).text === "string" ? ((part as { text?: string }).text ?? "") : "";
    })
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return inlineReferencePlainText(text);
}
