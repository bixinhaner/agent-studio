import type { PortalPartialAssistantSnapshot } from "./chat-partial-answer.js";

export const PORTAL_STOPPED_PLACEHOLDER_TEXT = "Response stopped.";

export function portalStoppedAssistantMessage(input: {
  id: string;
  sessionId: string;
  runId: string;
  reason: string;
  partial?: PortalPartialAssistantSnapshot;
}) {
  const now = new Date().toISOString();
  const partialText = input.partial?.answerText.trim() ? input.partial.answerText : undefined;
  return {
    id: input.id,
    role: "assistant",
    content: [
      ...(input.partial?.contentParts ?? []),
      {
        type: "text",
        text: partialText ?? PORTAL_STOPPED_PLACEHOLDER_TEXT
      },
      {
        type: "data",
        name: "codex_process_audit",
        data: {
          kind: "cancelled",
          at: now,
          title: "Stopped",
          detail: "The response was stopped before it completed.",
          reason: input.reason,
          ...(partialText ? { partialAnswerKept: true } : {})
        }
      }
    ],
    status: {
      type: "incomplete",
      reason: "cancelled"
    },
    createdAt: now,
    metadata: {
      unstable_state: {},
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {
        channel: "portal",
        sessionId: input.sessionId,
        runId: input.runId,
        serverPersisted: true,
        stopped: true,
        stopReason: input.reason
      }
    }
  };
}
