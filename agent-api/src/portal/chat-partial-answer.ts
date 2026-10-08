import type { CodexRunProjection, CodexRuntimeEventProjection } from "../operations/codex-execution-service.js";

/** What a stopped or failed turn keeps from the run: the answer streamed so far and the process parts. */
export type PortalPartialAssistantSnapshot = {
  answerText: string;
  contentParts: Record<string, unknown>[];
};

type PartialAnswerProjection = Pick<
  CodexRuntimeEventProjection,
  "itemId" | "agentMessagePhase" | "answerDelta" | "completedAgentMessage"
>;

const DEFAULT_SEGMENT_KEY = "answer";

/**
 * Follows the final-answer text of a run as runtime events are projected, so the
 * server can persist what the user already saw if the turn is stopped or fails.
 *
 * Commentary deltas never reach `answerDelta` (the projection routes them to the
 * commentary part), so only answer text is collected here. The last agent message
 * wins, matching how the completed answer is resolved.
 */
export class PortalPartialAnswerCollector {
  private readonly segments = new Map<string, string>();
  private latestKey: string | undefined;

  push(projection: PartialAnswerProjection): void {
    const key = projection.itemId?.trim() || DEFAULT_SEGMENT_KEY;
    if (projection.answerDelta) {
      this.segments.set(key, (this.segments.get(key) ?? "") + projection.answerDelta);
      this.latestKey = key;
    }
    const completed = projection.completedAgentMessage;
    if (!completed) return;
    const phase = completed.phase ?? projection.agentMessagePhase;
    if (phase && phase !== "final_answer") return;
    const completedKey = completed.id?.trim() || key;
    this.segments.set(completedKey, completed.text);
    this.latestKey = completedKey;
  }

  text(): string {
    return this.latestKey ? this.segments.get(this.latestKey) ?? "" : "";
  }

  reset(): void {
    this.segments.clear();
    this.latestKey = undefined;
  }
}

/**
 * Builds the snapshot a stop or failure persists. Protected brands never stream the
 * answer to the client, so the stopped message must not reveal it either.
 */
export function createPortalPartialSnapshot(input: {
  projection: Pick<CodexRunProjection, "finalize">;
  answer: Pick<PortalPartialAnswerCollector, "text">;
  instructionReadPart: () => Record<string, unknown> | undefined;
  memoryReadPart?: () => Record<string, unknown> | undefined;
  answerProtected: boolean;
}): () => PortalPartialAssistantSnapshot {
  return () => {
    const answerText = input.answerProtected ? "" : input.answer.text();
    const process = input.projection.finalize({ finalAnswer: answerText });
    return {
      answerText,
      contentParts: [input.memoryReadPart?.(), input.instructionReadPart(), ...process.contentParts]
        .filter((part): part is Record<string, unknown> => Boolean(part))
    };
  };
}
