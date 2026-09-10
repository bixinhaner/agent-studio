import type { ActionConnectorChatRequest } from "./runtime.js";

export function actionConnectorTurnMessageKey(request: ActionConnectorChatRequest, runId: string): string {
  const attempt = request.context?.assistantRunAttempt;
  // Durable recovery keeps the same business run and conversation, but is a
  // distinct message/response pair. Do not overwrite the earlier attempt.
  return Number.isSafeInteger(attempt) && (attempt as number) > 0
    ? `${runId}-attempt-${attempt}` : runId;
}
