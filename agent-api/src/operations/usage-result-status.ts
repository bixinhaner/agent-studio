/** A turn the user stopped on purpose. It still costs tokens but is not a service failure. */
export const USAGE_RESULT_CANCELLED = "cancelled";

/**
 * Result status for a turn that ended in an error. When the user's explicit stop request fired
 * (not a deploy drain, system interrupt or client disconnect) the turn is `cancelled`.
 */
export function usageResultStatusForTurn(
  resultStatus: "success" | "failed",
  userCancelSignal: AbortSignal | undefined
): "success" | "failed" | typeof USAGE_RESULT_CANCELLED {
  return resultStatus === "failed" && userCancelSignal?.aborted ? USAGE_RESULT_CANCELLED : resultStatus;
}

/** Failure counters exclude user cancellations; success counters still only count `success`. */
export function isUsageFailure(resultStatus: string | null | undefined): boolean {
  return resultStatus !== "success" && resultStatus !== USAGE_RESULT_CANCELLED;
}
