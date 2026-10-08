import { createContext, useCallback, useContext, useId, useMemo, useState, type FC, type FormEvent } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { CheckCircle2Icon, Loader2Icon, MessageCircleQuestionIcon } from "lucide-react";

import { usePortalComposerWorkflow } from "./composer-workflow";
import { usePortalI18n } from "./i18n";

/**
 * "Ask while working" (Codex request_user_input_async): the assistant asks one or more
 * multiple-choice questions and keeps working. While its response is still running, the
 * answer is steered into that response; after it ended, the answer is sent as a normal
 * follow-up message tagged with the question id so the portal and the admin transcript
 * can show which question it answered.
 */

export const USER_INPUT_REQUEST_PART_NAME = "codex_user_input_request";

export type UserInputQuestion = {
  title: string;
  options: string[];
};

export type UserInputRequestData = {
  id: string;
  questions: UserInputQuestion[];
  text?: string;
  askedAt?: string;
};

export type UserInputAnswerMetadata = {
  request_id: string;
  assistant_message_id?: string;
};

export type PortalBackgroundRunState = {
  /** The server still runs a response for the active thread that this tab is not streaming. */
  backgroundRunning: boolean;
};

export const PortalBackgroundRunContext = createContext<PortalBackgroundRunState>({ backgroundRunning: false });

/** True when user input in this tab must not start a new run (it would be rejected by the server). */
export const UserInputReadOnlyContext = createContext(false);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseUserInputRequestData(value: unknown): UserInputRequestData | null {
  const data = asRecord(value);
  const id = cleanString(data?.id);
  const questions = (Array.isArray(data?.questions) ? data.questions : [])
    .map((entry) => {
      const row = asRecord(entry);
      const title = cleanString(row?.title);
      const options = (Array.isArray(row?.options) ? row.options : []).map(cleanString).filter(Boolean);
      return title ? { title, options: Array.from(new Set(options)) } : null;
    })
    .filter((entry): entry is UserInputQuestion => Boolean(entry));
  if (!id || questions.length === 0) return null;
  const text = cleanString(data?.text);
  const askedAt = cleanString(data?.asked_at);
  return { id, questions, ...(text ? { text } : {}), ...(askedAt ? { askedAt } : {}) };
}

export function userInputAnswerFromMetadata(metadata: unknown): UserInputAnswerMetadata | null {
  const custom = asRecord(asRecord(metadata)?.custom);
  const answer = asRecord(custom?.user_input_answer);
  const requestId = cleanString(answer?.request_id);
  if (!requestId) return null;
  const assistantMessageId = cleanString(answer?.assistant_message_id);
  return { request_id: requestId, ...(assistantMessageId ? { assistant_message_id: assistantMessageId } : {}) };
}

/**
 * Builds the text sent to the assistant. A single question is answered with the plain
 * answer; several questions are answered line by line with the question they belong to.
 */
export function composeUserInputAnswer(
  questions: UserInputQuestion[],
  answers: string[],
  formatLine: (title: string, answer: string) => string
): string {
  if (questions.length === 1) return formatLine(questions[0]!.title, answers[0] ?? "");
  return questions.map((question, index) => formatLine(question.title, answers[index] ?? "")).join("\n");
}

function messageText(message: unknown): string {
  const content = asRecord(message)?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const row = asRecord(part);
      return row?.type === "text" && typeof row.text === "string" ? row.text : "";
    })
    .join("")
    .trim();
}

type AnswerResolution =
  | { kind: "answered"; text: string; via: "steer" | "message"; pending?: boolean }
  | { kind: "skipped" }
  | { kind: "open" };

type QuestionDraft = { choice: number | null; custom: string };

function initialDrafts(questions: UserInputQuestion[]): QuestionDraft[] {
  // The first option is the recommended default and starts preselected.
  return questions.map((question) => ({ choice: question.options.length > 0 ? 0 : null, custom: "" }));
}

export const UserInputRequestCard: FC<{ data: unknown }> = ({ data }) => {
  const request = useMemo(() => parseUserInputRequestData(data), [data]);
  if (!request) return null;
  return <UserInputRequestCardInner request={request} />;
};

const UserInputRequestCardInner: FC<{ request: UserInputRequestData }> = ({ request }) => {
  const { t } = usePortalI18n();
  const aui = useAui();
  const workflow = usePortalComposerWorkflow();
  const readOnly = useContext(UserInputReadOnlyContext);
  const { backgroundRunning } = useContext(PortalBackgroundRunContext);
  const formId = useId();
  const assistantMessageId = useAuiState((state) => state.message.id);
  const messageRunning = useAuiState(
    (state) => (state.message as { status?: { type?: string } }).status?.type === "running"
  );
  const isLastMessage = useAuiState((state) => Boolean((state.message as { isLast?: boolean }).isLast));
  const followUp = useAuiState((state) => {
    const messages = state.thread.messages;
    const index = state.message.index;
    let hasLaterUserMessage = false;
    for (let cursor = index + 1; cursor < messages.length; cursor += 1) {
      const candidate = messages[cursor];
      if (candidate?.role !== "user") continue;
      hasLaterUserMessage = true;
      const answer = userInputAnswerFromMetadata((candidate as { metadata?: unknown }).metadata);
      if (answer?.request_id === request.id) return `answer:${messageText(candidate)}`;
    }
    return hasLaterUserMessage ? "later" : "";
  });
  const steerAnswer = workflow.steerEvents.find(
    (event) => event.userInputRequestId === request.id && event.status !== "failed"
  );

  const resolution: AnswerResolution = steerAnswer
    ? { kind: "answered", text: steerAnswer.message, via: "steer", pending: steerAnswer.status === "pending" }
    : followUp.startsWith("answer:")
      ? { kind: "answered", text: followUp.slice("answer:".length), via: "message" }
      : followUp === "later"
        ? { kind: "skipped" }
        : { kind: "open" };

  const respondingLive = messageRunning || (isLastMessage && backgroundRunning);
  const [drafts, setDrafts] = useState<QuestionDraft[]>(() => initialDrafts(request.questions));
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState("");

  const answers = drafts.map((draft, index) => {
    const custom = draft.custom.trim();
    if (custom) return custom;
    const option = draft.choice !== null ? request.questions[index]?.options[draft.choice] : undefined;
    return option ?? "";
  });
  const complete = answers.every(Boolean);

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (readOnly || submitting) return;
      if (!complete) {
        setErrorText(t("userInput.answerRequired"));
        return;
      }
      const text = composeUserInputAnswer(request.questions, answers, (title, answer) =>
        request.questions.length === 1 ? answer : t("userInput.answerLine", { title, answer })
      );
      setErrorText("");
      setSubmitting(true);
      try {
        if (respondingLive) {
          await workflow.steer(text, undefined, { userInputRequestId: request.id });
        } else {
          const metadata: UserInputAnswerMetadata = { request_id: request.id, assistant_message_id: assistantMessageId };
          aui.thread().append({
            role: "user",
            content: [{ type: "text", text }],
            metadata: { custom: { user_input_answer: metadata } }
          });
        }
      } catch {
        setErrorText(t("userInput.failed"));
      } finally {
        setSubmitting(false);
      }
    },
    [answers, assistantMessageId, aui, complete, readOnly, request.id, request.questions, respondingLive, submitting, t, workflow]
  );

  if (resolution.kind !== "open") {
    return (
      <section className={`portal-user-input-card is-${resolution.kind}`} aria-label={t("userInput.title")}>
        <header className="portal-user-input-head">
          {resolution.kind === "answered" ? (
            <CheckCircle2Icon size={16} aria-hidden="true" className="portal-user-input-icon is-done" />
          ) : (
            <MessageCircleQuestionIcon size={16} aria-hidden="true" className="portal-user-input-icon" />
          )}
          <span className="portal-user-input-status">
            {resolution.kind === "answered"
              ? resolution.pending
                ? t("userInput.submitting")
                : resolution.via === "steer"
                  ? t("userInput.answeredDuringRun")
                  : t("userInput.answeredByMessage")
              : t("userInput.skipped")}
          </span>
        </header>
        <ol className="portal-user-input-summary">
          {request.questions.map((question, index) => (
            <li key={`${request.id}-${index}`}>
              <p className="portal-user-input-question">{question.title}</p>
            </li>
          ))}
        </ol>
        {resolution.kind === "answered" && resolution.text ? (
          <p className="portal-user-input-answer">
            <span className="portal-user-input-answer-label">{t("userInput.answered")}</span>
            <span className="portal-user-input-answer-text">{resolution.text}</span>
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section className="portal-user-input-card is-open" aria-labelledby={`${formId}-title`}>
      <header className="portal-user-input-head">
        <MessageCircleQuestionIcon size={16} aria-hidden="true" className="portal-user-input-icon" />
        <span id={`${formId}-title`} className="portal-user-input-title">{t("userInput.title")}</span>
      </header>
      <p className="portal-user-input-hint">
        {respondingLive ? t("userInput.workingHint") : t("userInput.waitingHint")}
      </p>
      <form className="portal-user-input-form" onSubmit={(event) => void submit(event)}>
        {request.questions.map((question, questionIndex) => {
          const draft = drafts[questionIndex]!;
          const groupName = `${formId}-q${questionIndex}`;
          const setDraft = (next: Partial<QuestionDraft>) =>
            setDrafts((current) => current.map((item, index) => (index === questionIndex ? { ...item, ...next } : item)));
          return (
            <fieldset key={groupName} className="portal-user-input-question-group" disabled={readOnly || submitting}>
              <legend className="portal-user-input-question">
                {request.questions.length > 1 ? (
                  <span className="portal-user-input-question-index">
                    {t("userInput.questionCount", { index: questionIndex + 1, count: request.questions.length })}
                  </span>
                ) : null}
                {question.title}
              </legend>
              {question.options.length > 0 ? (
                <div className="portal-user-input-options">
                  {question.options.map((option, optionIndex) => {
                    const selected = !draft.custom.trim() && draft.choice === optionIndex;
                    return (
                      <label key={`${groupName}-${optionIndex}`} className={`portal-user-input-option${selected ? " is-selected" : ""}`}>
                        <input
                          type="radio"
                          name={groupName}
                          checked={selected}
                          onChange={() => setDraft({ choice: optionIndex, custom: "" })}
                        />
                        <span className="portal-user-input-option-text">{option}</span>
                        {optionIndex === 0 ? (
                          <span className="portal-user-input-recommended">{t("userInput.recommended")}</span>
                        ) : null}
                      </label>
                    );
                  })}
                </div>
              ) : null}
              <label className="portal-user-input-custom">
                <span className="portal-user-input-custom-label">
                  {question.options.length > 0 ? t("userInput.otherLabel") : question.title}
                </span>
                <textarea
                  rows={question.options.length > 0 ? 1 : 2}
                  value={draft.custom}
                  placeholder={t("userInput.otherPlaceholder")}
                  onChange={(event) => setDraft({ custom: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
              </label>
            </fieldset>
          );
        })}
        <div className="portal-user-input-actions">
          {errorText ? (
            <span className="portal-user-input-error" role="alert">{errorText}</span>
          ) : null}
          <button type="submit" className="portal-user-input-submit" disabled={readOnly || submitting}>
            {submitting ? <Loader2Icon size={14} aria-hidden="true" className="portal-user-input-spinner" /> : null}
            {submitting ? t("userInput.submitting") : t("userInput.submit")}
          </button>
        </div>
      </form>
    </section>
  );
};
