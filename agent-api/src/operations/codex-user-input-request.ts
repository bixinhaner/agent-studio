/**
 * Codex `request_user_input_async` ("ask while working"): the model asks the user
 * one or more questions and keeps working. The app-server surfaces the question as
 * an `agentMessage` item that carries a structured `questions` array; the user's
 * answer is expected to arrive as a steer of the still-running turn.
 *
 * Portal persists each question as a `codex_user_input_request` data part so the
 * portal and the admin transcript can render the same interactive/read-only card.
 */

export const CODEX_USER_INPUT_REQUEST_PART_NAME = "codex_user_input_request";

const MAX_QUESTIONS = 8;
const MAX_OPTIONS = 8;
const MAX_TITLE_CHARS = 2_000;
const MAX_OPTION_CHARS = 300;

export type CodexUserInputQuestion = {
  title: string;
  /** Suggested answers in display order; the first one is the recommended default. Empty means free-text only. */
  options: string[];
};

export type CodexUserInputRequest = {
  id: string;
  questions: CodexUserInputQuestion[];
  /** Original agent message text, used to hide a duplicated plain-text copy of the question. */
  text?: string;
  askedAt: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function trimmedString(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

export function normalizeCodexUserInputQuestions(value: unknown): CodexUserInputQuestion[] {
  if (!Array.isArray(value)) return [];
  const questions: CodexUserInputQuestion[] = [];
  for (const entry of value) {
    const row = asRecord(entry);
    const title = trimmedString(row?.title, MAX_TITLE_CHARS);
    if (!title) continue;
    const options = Array.isArray(row?.options)
      ? Array.from(
          new Set(row.options.map((option) => trimmedString(option, MAX_OPTION_CHARS)).filter(Boolean))
        ).slice(0, MAX_OPTIONS)
      : [];
    questions.push({ title, options });
    if (questions.length >= MAX_QUESTIONS) break;
  }
  return questions;
}

/** Returns the question request carried by a normalized `agent_message` thread item, if any. */
export function codexUserInputRequestFromItem(
  item: unknown,
  askedAt: string = new Date().toISOString()
): CodexUserInputRequest | undefined {
  const row = asRecord(item);
  if (!row || (row.type !== "agent_message" && row.type !== "agentMessage")) return undefined;
  const id = trimmedString(row.id, 200);
  const questions = normalizeCodexUserInputQuestions(row.questions);
  if (!id || questions.length === 0) return undefined;
  const text = trimmedString(row.text, MAX_TITLE_CHARS * 2);
  return { id, questions, ...(text ? { text } : {}), askedAt };
}

export function codexUserInputRequestToContentPart(request: CodexUserInputRequest): Record<string, unknown> {
  return {
    type: "data",
    name: CODEX_USER_INPUT_REQUEST_PART_NAME,
    data: {
      id: request.id,
      questions: request.questions,
      ...(request.text ? { text: request.text } : {}),
      asked_at: request.askedAt
    }
  };
}

/** Reads `codex_user_input_request` parts back from a stored assistant message content array. */
export function codexUserInputRequestsFromContent(content: unknown): CodexUserInputRequest[] {
  if (!Array.isArray(content)) return [];
  const requests: CodexUserInputRequest[] = [];
  for (const part of content) {
    const row = asRecord(part);
    if (row?.type !== "data" || row.name !== CODEX_USER_INPUT_REQUEST_PART_NAME) continue;
    const data = asRecord(row.data);
    const id = trimmedString(data?.id, 200);
    const questions = normalizeCodexUserInputQuestions(data?.questions);
    if (!id || questions.length === 0) continue;
    const text = trimmedString(data?.text, MAX_TITLE_CHARS * 2);
    const askedAt = trimmedString(data?.asked_at, 64);
    requests.push({ id, questions, ...(text ? { text } : {}), askedAt });
  }
  return requests;
}

/** Answer metadata attached to a portal user message that replies to a question card after the turn ended. */
export type CodexUserInputAnswerMetadata = {
  request_id: string;
  assistant_message_id?: string;
};

export function codexUserInputAnswerFromMessageMetadata(message: unknown): CodexUserInputAnswerMetadata | undefined {
  const row = asRecord(message);
  const metadata = asRecord(row?.metadata);
  const custom = asRecord(metadata?.custom);
  const answer = asRecord(custom?.user_input_answer);
  const requestId = trimmedString(answer?.request_id, 200);
  if (!requestId) return undefined;
  const assistantMessageId = trimmedString(answer?.assistant_message_id, 200);
  return { request_id: requestId, ...(assistantMessageId ? { assistant_message_id: assistantMessageId } : {}) };
}
