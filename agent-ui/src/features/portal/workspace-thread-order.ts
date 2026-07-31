export type WorkspaceThreadOrderItem = {
  id: string;
  external_id?: string | null;
  updated_at: string;
};

export type WorkspaceThreadStateMap = Readonly<Record<string, boolean>>;

function identityKeys(thread: WorkspaceThreadOrderItem): string[] {
  return Array.from(new Set([thread.id, thread.external_id]
    .map((value) => String(value || "").trim())
    .filter(Boolean)));
}

export function isWorkspaceThreadPriority(
  thread: WorkspaceThreadOrderItem,
  runningThreadIds: WorkspaceThreadStateMap,
  unreadThreadIds: WorkspaceThreadStateMap
): boolean {
  return identityKeys(thread).some(
    (key) => runningThreadIds[key] || unreadThreadIds[key]
  );
}

export function sortWorkspaceThreads<T extends WorkspaceThreadOrderItem>(
  threads: readonly T[],
  runningThreadIds: WorkspaceThreadStateMap,
  unreadThreadIds: WorkspaceThreadStateMap
): T[] {
  return threads
    .map((thread, index) => ({
      thread,
      index,
      priority: isWorkspaceThreadPriority(thread, runningThreadIds, unreadThreadIds),
      updatedAt: Date.parse(thread.updated_at)
    }))
    .sort((left, right) => {
      if (left.priority !== right.priority) return left.priority ? -1 : 1;
      const leftUpdatedAt = Number.isFinite(left.updatedAt) ? left.updatedAt : 0;
      const rightUpdatedAt = Number.isFinite(right.updatedAt) ? right.updatedAt : 0;
      if (leftUpdatedAt !== rightUpdatedAt) return rightUpdatedAt - leftUpdatedAt;
      return left.index - right.index;
    })
    .map(({ thread }) => thread);
}

export function selectVisibleWorkspaceThreads<T extends WorkspaceThreadOrderItem>(
  sortedThreads: readonly T[],
  runningThreadIds: WorkspaceThreadStateMap,
  unreadThreadIds: WorkspaceThreadStateMap,
  ordinaryLimit: number,
  selectedThreadIds: WorkspaceThreadStateMap = {}
): T[] {
  const priorityThreads = sortedThreads.filter((thread) =>
    isWorkspaceThreadPriority(thread, runningThreadIds, unreadThreadIds)
  );
  const ordinaryThreads = sortedThreads
    .filter((thread) => !isWorkspaceThreadPriority(thread, runningThreadIds, unreadThreadIds))
    .slice(0, Math.max(0, ordinaryLimit - priorityThreads.length));
  const visibleThreads = [...priorityThreads, ...ordinaryThreads];
  const visibleThreadIds = new Set(visibleThreads.map((thread) => thread.id));
  const selectedOverflowThreads = sortedThreads.filter((thread) =>
    !visibleThreadIds.has(thread.id) &&
    identityKeys(thread).some((key) => selectedThreadIds[key])
  );
  return [...visibleThreads, ...selectedOverflowThreads];
}
