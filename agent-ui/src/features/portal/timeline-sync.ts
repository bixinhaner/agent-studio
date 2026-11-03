/**
 * A task is one timeline on the server, shared by every device and tab. An open page
 * learns the server's last message from the running-status poll and reloads the
 * timeline when it is behind (another device or tab added messages).
 */
export type ActiveThreadHead = { id: string; head_id: string | null };

export function shouldReloadTimeline(input: {
  activeThreadId: string;
  server: ActiveThreadHead | undefined;
  localHeadId: string;
  /**
   * This page is streaming, sending or settling a run in this task. A run going on
   * elsewhere does not hold the reload back: its question must be shown so the answer's
   * live progress can follow it.
   */
  localBusy: boolean;
  /** `${threadId}:${headId}` of the last reload, so one server state is loaded once. */
  lastReloadKey: string;
}): boolean {
  const serverHeadId = input.server?.head_id?.trim() ?? "";
  if (!input.activeThreadId || input.server?.id !== input.activeThreadId || !serverHeadId) return false;
  if (input.localBusy) return false;
  if (serverHeadId === input.localHeadId.trim()) return false;
  return timelineReloadKey(input.activeThreadId, serverHeadId) !== input.lastReloadKey;
}

export function timelineReloadKey(threadId: string, headId: string): string {
  return `${threadId}:${headId}`;
}
