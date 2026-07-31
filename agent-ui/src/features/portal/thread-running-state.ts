export type ThreadRunningStateMap = Readonly<Record<string, boolean>>;

export function filterStaleRuntimeThreadIds(
  runtimeThreadIds: ThreadRunningStateMap,
  activeThreadIds: ThreadRunningStateMap,
  serverThreadIds: ThreadRunningStateMap
): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  for (const threadId of Object.keys(runtimeThreadIds)) {
    if (activeThreadIds[threadId] || serverThreadIds[threadId]) {
      next[threadId] = true;
    }
  }
  return next;
}
