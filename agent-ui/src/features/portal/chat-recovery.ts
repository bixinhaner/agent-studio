export type PortalChatRecoveryEvent =
  | "run-start"
  | "automatic-retry"
  | "automatic-recovered"
  | "run-complete"
  | "run-failed";

export function resolvePortalChatRecoveryActive(current: boolean, event: PortalChatRecoveryEvent): boolean {
  if (event === "automatic-retry") return true;
  if (
    event === "run-start" ||
    event === "automatic-recovered" ||
    event === "run-complete" ||
    event === "run-failed"
  ) return false;
  return current;
}
