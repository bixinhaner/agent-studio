import { portalAutoRecoveryFailureAssistantMessage } from "./chat-auto-recovery.js";
import type { PortalFailurePresentation } from "./chat-failure-presentation.js";
import type { PortalPartialAssistantSnapshot } from "./chat-partial-answer.js";

export function portalFailedAssistantMessage(input: {
  id: string;
  sessionId?: string;
  runId: string;
  presentation: PortalFailurePresentation;
  autoRecoveryAttempted?: boolean;
  partial?: PortalPartialAssistantSnapshot;
}) {
  if (input.autoRecoveryAttempted) {
    return portalAutoRecoveryFailureAssistantMessage({
      id: input.id,
      sessionId: input.sessionId || "unavailable",
      runId: input.runId,
      partial: input.partial
    });
  }
  const now = new Date().toISOString();
  return {
    id: input.id,
    role: "assistant",
    content: [
      ...(input.partial?.contentParts ?? []),
      ...(input.partial?.answerText.trim() ? [{ type: "text", text: input.partial.answerText }] : []),
      {
        type: "text",
        text: input.presentation.userMessage
      },
      {
        type: "data",
        name: "codex_process_audit",
        data: {
          kind: "error",
          at: now,
          title: "Needs attention",
          detail: input.presentation.userMessage,
          rawDetail: input.presentation.rawDetail,
          ...(input.presentation.code ? { code: input.presentation.code } : {}),
          ...(input.presentation.reasonCode ? { reasonCode: input.presentation.reasonCode } : {})
        }
      }
    ],
    status: {
      type: "incomplete",
      reason: "error"
    },
    createdAt: now,
    metadata: {
      unstable_state: {},
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {
        channel: "portal",
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        runId: input.runId,
        serverPersisted: true,
        failed: true,
        autoRecoveryAttempted: false
      }
    }
  };
}
