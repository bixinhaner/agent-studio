import type { PortalPartialAssistantSnapshot } from "./chat-partial-answer.js";

/**
 * The answer a portal run has produced so far, shaped as a running assistant message.
 * Other devices and tabs of the same user show it while the run streams elsewhere, so
 * they see the progress instead of only "still running". It is never persisted: the
 * finished answer replaces it once the run ends.
 */
export function portalLiveAssistantMessage(input: {
  id: string;
  runId: string;
  acceptedAt?: string;
  partial?: PortalPartialAssistantSnapshot;
}) {
  const answerText = input.partial?.answerText ?? "";
  return {
    id: input.id,
    role: "assistant",
    content: [
      ...(input.partial?.contentParts ?? []),
      ...(answerText.trim() ? [{ type: "text", text: answerText }] : [])
    ],
    status: { type: "running" },
    createdAt: input.acceptedAt ?? new Date().toISOString(),
    metadata: {
      unstable_state: {},
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {
        channel: "portal",
        runId: input.runId,
        live: true
      }
    }
  };
}

/** Stable id of the live message of a run, so a polling client keeps one rendered message. */
export function portalLiveAssistantMessageId(run: { runId: string; assistantMessageId?: string }): string {
  return run.assistantMessageId?.trim() || `portal-live-${run.runId}`;
}
